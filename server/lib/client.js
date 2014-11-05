/**
 * Handle a new ws client connection from the server. The process
 * goes through two phases.  First, the client needs to send a
 * token obtained via the /api/sync HTTP route, identifying them.
 * After we have confirmed the client's identity, we run the sync
 * protocol as normal.
 */
var SyncProtocolHandler = require('./sync-protocol-handler.js');
var EventEmitter = require('events').EventEmitter;
var ClientInfo = require('./client-info.js');
var Constants = require('../../lib/constants.js');
var States = Constants.server.states;
var syncTypes = Constants.syncTypes;
var redis = require('../redis-clients.js');
var util = require('util');
var log = require('./logger.js');
var findPathIndexInArray = require('../../lib/util.js').findPathIndexInArray;

var noop = function(){};

function handleBroadcastMessage(msg, client) {
  try {
    msg = JSON.parse(msg);
  } catch(err) {
    log.error({client: client, err: err}, 'Could not parse redis pub/sub message, message was `%s`', msg);
    return;
  }

  // Not meant for this client's user, skip
  if(client.username !== msg.username) {
    return;
  }

  // Don't bother if this client a) was the one that just sync'ed
  // and triggered the update broadcast; or b) is just initiating
  // and can't do an(other) update yet;
  if(client.id === msg.id) {
    return;
  }
  //  or c) is closed, closing, errored, etc.
  if(client.state !== States.LISTENING || !client.handler) {
    log.warn({client: client}, 'Got broadcast message for client not in LISTENING state, or missing handler.');
    return;
  }

  client.outOfDate = client.outOfDate || [];
  client.currentDownstream = client.currentDownstream || [];
  var outOfDateSync = {path: msg.path, type: msg.type};
  if(msg.type === syncTypes.RENAME) {
    outOfDateSync.oldPath = msg.oldPath;
  }
  client.outOfDate.push(outOfDateSync);

  client.handler.syncDownstream();
}

function Client(ws) {
  var self = this;
  EventEmitter.call(self);

  // A bit of safety around the changing of states
  var state = States.CREATED;
  Object.defineProperty(self, 'state', {
    get: function() { return state; },
    set: function(value) {
      if(!States[value]) {
        log.error({client: self}, 'Tried to change to an unknown state (%s) from (%s)', value, state);
        throw new Error('unknown state', value);
      }
      state = value;
    }
  });

  self.ws = ws;

  // `closable` indicates whether or not it is safe to stop the client, specifically
  // whether or not we are in a sync step (e.g., patching) that will leave the
  // server's filesystem corrupt if not completed.
  self.closable = true;
  // We start using this in client-manager.js when a client is fully authenticated.
  self.handler = new SyncProtocolHandler(self);
  self.outOfDate = [];

  ws.onerror = function(err) {
    log.error({err: err, client: self}, 'Web Socket error');
    self.close();
  };

  ws.onclose = function() {
    // Client hung-up early
    log.debug({client: self}, 'Client socket hung-up.');
    self.close();
  };

  // Process update messages from other servers
  self._broadcastMessageHandlerFn = function(msg) {
    handleBroadcastMessage(msg, self);
  };
  redis.on('sync', self._broadcastMessageHandlerFn);

  // Sugar for testing states
  self.is = Object.create(Object.prototype, {
    listening: {
      get: function() { return self.state === States.LISTENING; }
    },
    outOfDate: {
      get: function() { return self.state === States.OUT_OF_DATE; }
    },
    initiating: {
      get: function() { return self.state === States.INIT; }
    },
    downstreaming: {
      get: function() { return self.state === States.INIT ||
                               self.state === States.OUT_OF_DATE;
      }
    },
    chksum: {
      get: function() { return self.state === States.CHKSUM; }
    },
    patch: {
      get: function() { return self.state === States.PATCH; }
    },
    error: {
      get: function() { return self.state === States.ERROR; }
    },
    closed: {
      get: function() { return self.state === States.CLOSED; }
    }
  });
}
util.inherits(Client, EventEmitter);

Client.prototype.close = function(error) {
  var self = this;

  if(self.state === States.CLOSED) {
    log.warn({client: self}, 'Called client.close() on previously closed client');
    return;
  }

  self.state = States.CLOSING;

  // Stop processing update broadcast messages
  redis.removeListener('sync', self._broadcastMessageHandlerFn);
  self._broadcastMessageHandlerFn = null;

  // Cleanup the sync protocol handler, waiting until any
  // uninterruptable sync steps have completed.
  self.handler.close(function() {
    self.handler.removeAllListeners();
    self.handler = null;

    // We should never be holding a lock at this point, if we are it's a bug.
    if(self.lock) {
      log.warn({client: self, syncLock: self.lock}, 'Client still holding lock during client.close()!');
    }

    // If we're passed error info, try to close with that first
    if(self.ws) {
      error = error || {};
      self.ws.onclose = noop;

      if(error.code && error.message) {
        // Ignore onerror, oncall with this call
        self.ws.onerror = noop;
        self.ws.close(error.code, error.message);
      }

      // Dump all listeners, tear down socket
      self.ws.terminate();
      self.ws = null;
    }

    // TODO: should I clean up filesystem cache for user too?
    // https://github.com/mozilla/makedrive/issues/385
    self.fs = null;

    self.state = States.CLOSED;
    log.info({client: self}, 'Client closed.');
    self.emit('closed');
  });
};

// Helper for getting the ClientInfo object for this client
Client.prototype.info = function() {
  return ClientInfo.find(this);
};

Client.prototype.sendMessage = function(syncMessage) {
  var self = this;
  var ws = self.ws;
  var info = self.info();

  if(!ws || ws.readyState !== ws.OPEN) {
    log.error({client: self, syncMessage: syncMessage, err: new Error('invalid state')},
              'Unable to send message to client, web socket not open');
    return;
  }

  try {
    // Keep track of how much data we send
    var data = syncMessage.stringify();
    if(info) {
      info.bytesSent += Buffer.byteLength(data, 'utf8');
    }

    ws.send(syncMessage.stringify());
    log.debug({syncMessage: syncMessage, client: self}, 'Sending Sync Protocol Message');
  } catch(err) {
    log.error({err: err, client: self, syncMessage: syncMessage},
              'Error sending client message over web socket.');
    self.state = States.ERROR;
    self.close();
  }
};

Client.prototype.delaySync = function(path) {
  var self = this;
  var indexInCurrent = findPathIndexInArray(self.currentDownstream, path);
  var delayedSync = indexInCurrent === -1 ? null : self.currentDownstream.splice(indexInCurrent, 1);
  var syncTime;

  if(delayedSync) {
    syncTime = Date.now() - (delayedSync._syncStarted || 0);
    log.info({client: self}, 'Downstream sync delayed for ' + path + ' after ' + syncTime + ' ms');
  } else {
    log.warn({client: self}, 'Sync entry not found in current downstreams when attempting to delay sync for ' + path);
  }
};

Client.prototype.endDownstream = function(path) {
  var self = this;
  var indexInCurrent = findPathIndexInArray(self.currentDownstream, path);
  var indexInOutOfDate = findPathIndexInArray(self.outOfDate, path);
  var syncEnded;
  var syncTime;

  if(indexInCurrent === -1) {
    log.warn({client: self}, 'Sync entry not found in current downstreams when attempting to end sync for ' + path);
  } else {
    syncEnded = self.currentDownstream.splice(indexInCurrent, 1);
  }

  syncTime = syncEnded ? Date.now() - syncEnded._syncStarted : 0;

  if(indexInOutOfDate === -1) {
    log.warn({client: self}, 'Sync entry not found in out of date list when attempting to end sync for ' + path);
    return;
  }

  self.outOfDate.splice(indexInOutOfDate, 1);
  log.info({client: self}, 'Downstream sync completed for ' + path + ' in ' + syncTime + ' ms');
};

module.exports = Client;
