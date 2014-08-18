/**
 * Sync module for creating and managing syncs
 * between client and server
 */
var filesystem = require( "./filesystem" );
var SyncMessage = require('../../lib/syncmessage');
var rsync = require('../../lib/rsync');
var diffHelper = require('../../lib/diff');
var rsyncOptions = require('../../lib/constants').rsyncDefaults;
var env = require('../../server/lib/environment');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

// Table of connected clients, keyed by username. Each connected client
// has its own unique id (i.e., token obtained from /api/sync), but
// multiple connected clients may share a username (e.g., user A connects
// from a laptop and desktop at the same time--two tokens, one username).
var connectedClients = {};

// Active syncs manager, with list of active syncs keyed by username. While
// a given user may connect multiple sessions at once (multiple browsers
// or devices), only one of these connections can sync upstream to the server
// at a time. This keeps track of which client connection is currently syncing
// for the given username (if any), manages access to the active sync per user.
var activeSyncs = (function() {
  var syncs = {};

  function byUsername(username) {
    return syncs[username];
  }

  function removeActive(username) {
    var sync = byUsername(username);
    if(!sync) {
      return;
    }

    sync.reset();
    delete syncs[sync.username];
  }

  function setActive(sync) {
    if(byUsername(sync.username)) {
      removeActive(sync.username);
    }
    syncs[sync.username] = sync;
  }

  return {
    setActive: setActive,
    removeActive: removeActive,
    byUsername: byUsername,
    get containsSyncs() { return Object.keys(syncs).length; }
  };
}());

var CLIENT_TIMEOUT_MS = env.get('CLIENT_TIMEOUT_MS') || 5000;

function Sync(username, id, ws) {
  EventEmitter.call(this);

  var sync = this;

  sync.id = id;
  sync.username = username;

  // Ensure the current user exists in our datastore and
  // track this client session keyed by a new `syncId`
  if (!connectedClients[username]) {
    connectedClients[username] = {};
  }
  connectedClients[username][id] = sync;

  sync.fs = filesystem.create({
    keyPrefix: username,
    name: username
  });

  sync.path = '/';

  // Safe access to WebSocket.send(). If we encounter an error
  // we emit an 'error' event to the caller. The optional second
  // arg indicates whether or not to also update the last time
  // we had contact from the client, since we typically only send
  // messages in response to client requests.
  sync.sendMessage = function(syncMessage, shouldUpdateLastContact) {
    function error(msg) {
      sync.state = Sync.ERROR;
      sync.emit('error', new Error(msg));
    }

    // Bail if we're shutdown (or in the process of shutting down).
    // This is important for async rsync operations that may complete
    // after we start shutting down the sync/ws for some reason, and
    // want to send data back on their callback.
    if(sync.state === Sync.ERROR || sync.state === Sync.CLOSED) {
      return;
    }

    if(!ws || ws.readyState !== ws.OPEN) {
      return error('Socket state invalid for sending');
    }

    if(shouldUpdateLastContact) {
      sync.updateLastContact();
    }

    try {
      ws.send(syncMessage.stringify());
    } catch(err) {
      error('Socket error while sending message');
    }
  };

  // Flag indicating if the server is writing data to this
  // user's filesystem, used to prevent data loss on errors by
  // blocking actions that could interrupt this process.
  sync.patching = false;

  // State
  sync.state = Sync.INIT;
  sync.is = Object.create(Object.prototype, {
    listening: {
      get: function() { return sync.state === Sync.LISTENING; }
    },
    outOfDate: {
      get: function() { return sync.state === Sync.OUT_OF_DATE; }
    },
    initiating: {
      get: function() { return sync.state === Sync.INIT; }
    },
    downstreaming: {
      get: function() { return sync.state === Sync.INIT || sync.state === Sync.OUT_OF_DATE; }
    },
    chksum: {
      get: function() { return sync.state === Sync.CHKSUM; }
    },
    patch: {
      get: function() { return sync.state === Sync.PATCH; }
    },
    error: {
      get: function() { return sync.state === Sync.ERROR; }
    },
    closed: {
      get: function() { return sync.state === Sync.CLOSED; }
    }
  });
}
util.inherits(Sync, EventEmitter);
Sync.safeMode = false;

// This object wraps the Sync constructor, and acts as an EventEmitter
// for Syncs in general.
var controller = new EventEmitter();
controller.create =function(username, token, ws) {
  return new Sync(username, token, ws);
};
controller.Sync = Sync;
// In the case of server errors, we want to safely shut down
// any currently active syncs. To start, we immediately
// kill all active syncs that are not already writing to their
// respective user's filesystems. Afterwards, we monitor the syncs
// that are making write operations, and emit an event when they are
// all complete.
controller.initiateSafeShutdown = function() {
  // Checks to see if there are no active syncs left
  // so we can safely shut down the server.
  function areSyncsComplete() {
    if (!activeSyncs.containsSyncs) {
      controller.emit('allSyncsComplete');
    }
  }

  function closeActiveSync(username, activeSync) {
    return function() {
      activeSync.close();
      activeSyncs.removeActive(username);

      areSyncsComplete();
    };
  }

  // Enable safe mode, effectively locking the server by
  // preventing new websocket connections and preventing
  // regular SyncMessage protocol actions.
  Sync.safeMode = true;

  var activeSync;
  for (var username in connectedClients) {
    activeSync = activeSyncs.byUsername(username);

    if (activeSync) {
      if (!activeSync.patching) {
        activeSync.close();
        activeSyncs.removeActive(username);
      }

      // Listen for an indicator that the patch is complete
      // so we can safely close this sync
      activeSync.once('patchComplete', closeActiveSync(username, activeSync));
    }
  }

  areSyncsComplete();
};

/**
 * Sync states
 */
Sync.LISTENING = "LISTENING";
Sync.OUT_OF_DATE = "OUT OF DATE";
Sync.CHKSUM = "CHECKSUM";
Sync.PATCH = "PATCH";
Sync.ERROR = "ERROR";
Sync.CLOSED = "CLOSED";
Sync.INIT = "INIT";

// Initialize a sync for a client
Sync.prototype.init = function(path) {
  var sync = this;

  // If there's already a sync underway for this user, see if
  // it's stalled, and if so we can keep going.
  if(activeSyncs.byUsername(sync.username)) {
    if(!sync.canSync()) {
      // Bail, since we can't sync (yet).
      return;
    }

    // Reset the existing stalled active sync so we can start a new one
    activeSyncs.removeActive(sync.username);
  }

  // Start an active sync for this user/client
  sync.path = path;
  activeSyncs.setActive(sync);
};

// End a completed sync for a client
Sync.prototype.end = function(patchResponse) {
  var sync = this;

  // If there's no sync underway, bail
  if(!activeSyncs.byUsername(sync.username)) {
    return;
  }

  // Broadcast to (any) other clients for this username that there are changes
  rsync.sourceList(sync.fs, sync.path, rsyncOptions, function(err, srcList) {
    var response;
    if(err) {
      response = SyncMessage.error.srclist;
      response.content = {error: err};
    } else {
      response = SyncMessage.request.chksum;
      response.content = {srcList: srcList, path: sync.path};
    }
    sync.lastContact = null;
    broadcastUpdate(sync.username, response);
    activeSyncs.removeActive(sync.username);
    sync.sendMessage(patchResponse);
  });
};

// Reset a sync's state
Sync.prototype.reset = function() {
  var sync = this;
  sync.lastContact = null;
  sync.state = Sync.LISTENING;
};

// Whether the client can begin an upstream sync. The answer to this
// depends on a) whether there is already an active sync going for this
// username (e.g., secondary client connection), b) if a) is true
// but the sync has stalled and could be killed; or c) if a) is true
// but the sync is in the patch step, and can't be interrupted
Sync.prototype.canSync = function() {
  var now = Date.now();
  var activeSync = activeSyncs.byUsername(this.username);
  if(!activeSync) {
    return true;
  }

  // If we're writing to the filesystem at this point in the active sync,
  // lock it no matter what. Also block if the safe mode is enabled,
  // meaning we're trying to recover from a serious error and shouldn't
  // risk a new sync.
  if(activeSync.patching || Sync.safeMode) {
    return false;
  }

  return (now - activeSync.lastContact > CLIENT_TIMEOUT_MS);
};

// Handle a message sent by the client
Sync.prototype.handleMessage = function(message) {
  var sync = this;

  if(message.is.request) {
    handleRequest(sync, message);
  } else if(message.is.response) {
    handleResponse(sync, message);
  } else {
    sync.sendMessage(Sync.error.type);
  }
};

// Close and finalize the sync session
Sync.prototype.close = function() {
  var sync = this;

  if(sync.is.closed) {
    return;
  }

  sync.state = Sync.CLOSED;

  // Get rid of any error listeners
  sync.removeAllListeners();

  var username = sync.username;
  var id = sync.id;
  delete connectedClients[username][id];

  // Make sure we don't leave this sync session active for some reason
  var activeSync = activeSyncs.byUsername(username);
  if(activeSync && activeSync.id === id) {
    activeSyncs.removeActive(username);
  }

  // Also remove the username from the list if there are no more connected clients.
  if(Object.keys(connectedClients[username]).length === 0) {
    delete connectedClients[username];
    filesystem.clearCache(username);
  }
};

// Used to keep track of the last time a message was received from
// the client during an upstream sync. By comparing Date.now() to
// lastContact, we can determine if a sync should be unlocked.
Sync.prototype.updateLastContact = function() {
  this.lastContact = Date.now();
};

Sync.error = {
  get type() {
    var message = SyncMessage.error.impl;
    message.content = {error: 'The Sync message cannot be handled by the server'};
    return message;
  },
  get request() {
    var message = SyncMessage.error.impl;
    message.content = {error: 'Request cannot be processed'};
    return message;
  },
  get response() {
    var message = SyncMessage.error.impl;
    message.content = {error: 'The resource sent as a response cannot be processed'};
    return message;
  }
};

// Handle requested resources
function handleRequest(sync, data) {
  var response;

  function handleUpstreamReset() {
    sync.end();
    sync.state = Sync.LISTENING;
  }

  function handleDiffRequest() {
    if(!data.content || !data.content.checksums) {
      return sync.sendMessage(SyncMessage.error.content, true);
    }

    var checksums = data.content.checksums;

    rsync.diff(sync.fs, sync.path, checksums, rsyncOptions, function(err, diffs) {
      if(err) {
        response = SyncMessage.error.diffs;
        response.content = {error: err};
      } else {
        response = SyncMessage.response.diffs;
        response.content = {
          diffs: diffHelper.serialize(diffs),
          path: sync.path
        };
      }

      sync.sendMessage(response, true);
    });
  }

  function handleSyncInitRequest() {
    if(!data.content || !data.content.path) {
      return sync.sendMessage(SyncMessage.error.content, true);
    }

    if(sync.canSync()) {
      response = SyncMessage.response.sync;
      response.content = {path: data.content.path};
      sync.updateLastContact();
      sync.state = Sync.CHKSUM;
      sync.init(data.content.path);
    } else {
      response = SyncMessage.error.locked;
      response.content = {error: "Current sync in progress! Try again later!"};
    }
    sync.sendMessage(response);
  }

  function handleChecksumRequest() {
    if(!data.content || !data.content.srcList) {
      return sync.sendMessage(SyncMessage.error.content, true);
    }

    var srcList = data.content.srcList;

    rsync.checksums(sync.fs, sync.path, srcList, rsyncOptions, function(err, checksums) {
      if(err) {
        sync.state = Sync.LISTENING;
        response = SyncMessage.error.chksum;
        response.content = {error: err};
        activeSyncs.removeActive(sync.username);
      } else {
        response = SyncMessage.request.diffs;
        response.content = {checksums: checksums};
        sync.state = Sync.PATCH;
      }

      sync.sendMessage(response, true);
    });
  }

  // In safe mode, we ignore all messages coming in from connected clients
  // since we are in the process of safely shutting down all connections and
  // the socket server itself.
  if (Sync.safeMode) {
    sync.sendMessage(SyncMessage.error.serverReset);
    return;
  }

  if(data.is.reset && !sync.is.downstreaming) {
    handleUpstreamReset();
  } else if(data.is.diffs && sync.is.downstreaming) {
    handleDiffRequest();
  } else if(data.is.sync && !sync.is.downstreaming) {
    handleSyncInitRequest();
  } else if(data.is.chksum && sync.is.chksum) {
    handleChecksumRequest();
  } else {
    sync.sendMessage(Sync.error.request, true);
  }
}

// Handle responses sent by the client
function handleResponse(sync, data) {
  var response;

  function handleDownstreamReset() {
    rsync.sourceList(sync.fs, '/', rsyncOptions, function(err, srcList) {
      if(err) {
        response = SyncMessage.error.srclist;
        response.content = {error: err};
      } else {
        response = SyncMessage.request.chksum;
        response.content = {srcList: srcList, path: '/'};
      }
      sync.sendMessage(response, true);
    });
  }

  function handleDiffResponse() {
    if(!data.content || !data.content.diffs) {
      return sync.sendMessage(SyncMessage.error.content);
    }

    var diffs = diffHelper.deserialize(data.content.diffs);
    sync.state = Sync.LISTENING;

    // Flag that changes are being made to the filesystem,
    // preventing actions that could interrupt this process
    // and corrupt data.
    try {
      sync.patching = true;
      rsync.patch(sync.fs, sync.path, diffs, rsyncOptions, function(err, paths) {
        sync.patching = false;

        if(err) {
          activeSyncs.removeActive(sync.username);
          response = SyncMessage.error.patch;
          response.content = paths;
          return sync.sendMessage(response);
        }

        response = SyncMessage.response.patch;
        response.content = {syncedPaths: paths.synced};
        sync.end(response);
      });
    } catch (e) {
      // Handle rsync failing badly on a patch step
      // TODO: https://github.com/mozilla/makedrive/issues/31
    }
  }

  function handlePatchResponse() {
    if(!data.content || !data.content.checksums) {
      return sync.sendMessage(SyncMessage.error.content);
    }

    var checksums = data.content.checksums;
    var size = data.content.size || 5;

    rsync.compareContents(sync.fs, checksums, size, function(err, equal) {
      // We need to check if equal is true because equal can have three possible
      // return value. 1. equal = true, 2. equal = false, 3. equal = undefined
      // we want to send error verification in case of err return or equal is false.
      if(equal) {
        sync.state = Sync.LISTENING;
        response = SyncMessage.response.verification;
      } else {
        response = SyncMessage.error.verification;
      }

      sync.sendMessage(response);
    });
  }

  // In safe mode, we ignore all messages coming in from connected clients
  // since we are in the process of safely shutting down all connections and
  // the socket server itself.
  if (Sync.safeMode) {
    sync.sendMessage(SyncMessage.error.serverReset);
    return;
  }

  if (data.is.reset || data.is.authz) {
    handleDownstreamReset();
  } else if(data.is.diffs && sync.is.patch) {
    handleDiffResponse();
  } else if(data.is.patch && sync.is.downstreaming) {
    handlePatchResponse();
  } else {
    sync.sendMessage(Sync.error.response);
  }
}

// Broadcast an out-of-date message to the all clients other than
// the active sync after an upstream sync process has completed.
function broadcastUpdate(username, response) {
  var clients = connectedClients[username];
  var activeSync = activeSyncs.byUsername(username);
  var outOfDateClient;

  if(!clients) {
    return;
  }
  if(!activeSync) {
    return;
  }

  Object.keys(clients).forEach(function(id) {
    if(activeSync.id === id || clients[id].is.initiating) {
      return;
    }

    outOfDateClient = clients[id];
    outOfDateClient.state = Sync.OUT_OF_DATE;
    outOfDateClient.path = response.content.path;
    outOfDateClient.sendMessage(response);
  });
}

module.exports = controller;
