/**
 * Sync() module for creating and managing syncs
 * between client and server
 */
var filesystem = require( "./filesystem" ),
    SyncMessage = require('../../lib/syncmessage'),
    rsync = require('../../lib/rsync'),
    diffHelper = require('../../lib/diff'),
    rsyncOptions = require('../../lib/constants').rsyncDefaults,
    env = require('../../server/lib/environment');

var CLIENT_TIMEOUT_MS = env.get('CLIENT_TIMEOUT_MS') || 5000;

/**
 * Static public variables
 */
Sync.LISTENING = "LISTENING";
Sync.OUT_OF_DATE = "OUT OF DATE";
Sync.CHKSUM = "CHECKSUM";
Sync.PATCH = "PATCH";

/**
 * Static private variables
 */
var connectedClients = {};

/**
 * Helper functions
 */
// Handle requested resources
function handleRequest(data) {
  var that = this;
  var response;

  function handleUpstreamReset() {
    that.end();
    that.state = Sync.LISTENING;
  }

  function handleDiffRequest() {
    if(!data.content || !data.content.checksums) {
      that.updateLastContact();
      return that.socket.send(SyncMessage.error.content.stringify());
    }

    var checksums = data.content.checksums;

    rsync.diff(that.fs, that.path, checksums, rsyncOptions, function(err, diffs) {
      if(err) {
        response = SyncMessage.error.diffs;
        response.content = {error: err};
      } else {
        response = SyncMessage.response.diffs;
        response.content = {
          diffs: diffHelper.serialize(diffs),
          path: that.path
        };
      }
      that.updateLastContact();
      that.socket.send(response.stringify());
    });
  }

  function handleSyncInitRequest() {
    if(!data.content || !data.content.path) {
      that.updateLastContact();
      return that.socket.send(SyncMessage.error.content.stringify());
    }

    if(that.canSync()) {
      response = SyncMessage.response.sync;
      that.state = Sync.CHKSUM;
      that.init(data.content.path);
      that.updateLastContact();
    } else {
      response = SyncMessage.error.locked;
      response.content = { error: "Current sync in progress! Try again later!" };
    }
    that.socket.send(response.stringify());
  }

  function handleChecksumRequest() {
    if(!data.content || !data.content.srcList) {
      that.updateLastContact();
      return that.socket.send(SyncMessage.error.content.stringify());
    }

    var srcList = data.content.srcList;

    rsync.checksums(that.fs, that.path, srcList, rsyncOptions, function(err, checksums) {
      if(err) {
        that.state = Sync.LISTENING;
        response = SyncMessage.error.chksum;
        response.content = {error: err};
        delete connectedClients[that.username].currentSyncSession;
      } else {
        response = SyncMessage.request.diffs;
        response.content = {checksums: checksums};
        that.state = Sync.PATCH;
      }
      that.updateLastContact();
      that.socket.send(response.stringify());
    });
  }

  // Check if a sync is in progress, removing the lock if necessary
  that.clearUpstreamSync();

  if(data.is.reset && that.state !== Sync.OUT_OF_DATE) {
    handleUpstreamReset();
  } else if(data.is.diffs && that.state === Sync.OUT_OF_DATE) {
    handleDiffRequest();
  } else if(data.is.sync && that.state === Sync.LISTENING) {
    handleSyncInitRequest();
  } else if(data.is.chksum && that.state === Sync.CHKSUM) {
    handleChecksumRequest();
  } else {
    that.updateLastContact();
    that.socket.send(Sync.error.request.stringify());
  }
}

// Handle responses sent by the client
function handleResponse(data) {
  var that = this;
  var response;

  function handleDownstreamReset() {
    rsync.sourceList(that.fs, '/', rsyncOptions, function(err, srcList) {
      if(err) {
        response = SyncMessage.error.srclist;
        response.content = {error: err};
      } else {
        response = SyncMessage.request.chksum;
        response.content = {srcList: srcList, path: '/'};
      }
      that.updateLastContact();
      that.socket.send(response.stringify());
    });
  }

  function handleDiffResponse() {
    if(!data.content || !data.content.diffs) {
      return that.socket.send(SyncMessage.error.content.stringify());
    }

    var diffs = diffHelper.deserialize(data.content.diffs);
    that.state = Sync.LISTENING;

    rsync.patch(that.fs, that.path, diffs, rsyncOptions, function(err, paths) {
      if(err) {
        delete connectedClients[that.username].currentSyncSession;
        response = SyncMessage.error.patch;
        response.content = paths;
        return that.socket.send(response.stringify());
      }

      response = SyncMessage.response.patch;
      response.content = {syncedPaths: paths.synced};
      that.socket.send(response.stringify());
      that.end();
    });
  }

  function handlePatchResponse() {
    if(!data.content || !data.content.checksums) {
      return that.socket.send(SyncMessage.error.content.stringify());
    }

    var checksums = data.content.checksums;
    var size = data.content.size || 5;

    rsync.compareContents(that.fs, checksums, size, function(err, equal) {
      if(equal) {
        that.state = Sync.LISTENING;
        response = SyncMessage.response.verification;
      } else {
        response = SyncMessage.error.verification;
      }

      that.socket.send(response.stringify());
    });
  }

  if (data.is.reset) {
    handleDownstreamReset();
  } else if(data.is.diffs && that.state === Sync.PATCH) {
    handleDiffResponse();
  } else if(data.is.patch && that.state === Sync.OUT_OF_DATE) {
    handlePatchResponse();
  } else {
    that.socket.send(Sync.error.response.stringify());
  }
}

// Broadcast an out-of-date message to the clients
// after an upstream sync process has completed
function broadcastUpdate(username, response) {
  var clients = connectedClients[username];
  var currSyncingClient = clients.currentSyncSession;
  var outOfDateClient;
  if(clients) {
    Object.keys(clients).forEach(function(sessionId) {
      // TODO -- Fix this dirty hack
      if(currSyncingClient !== sessionId && sessionId !== "currentSyncSession") {
        outOfDateClient = clients[sessionId].sync;
        outOfDateClient.state = Sync.OUT_OF_DATE;
        outOfDateClient.socket.send(response.stringify());
      }
    });
  }
}

/**
 * Constructor
 */
function Sync(username, sessionId) {
  this.sessionId = sessionId;
  this.username = username;

  // Ensure the current user exists in our datastore and
  // track this client session keyed by a new `syncId`
  if (!connectedClients[username]) {
    connectedClients[username] = {};
  }
  connectedClients[username][sessionId] = {
    sync: this
  };
  this.fs = filesystem.create({
    keyPrefix: username,
    name: username
  });
  this.state = Sync.OUT_OF_DATE;
  this.path = '/';
}

// Initialize a sync for a client
Sync.prototype.init = function(path) {
  if(!(connectedClients[this.username].currentSyncSession)) {
    this.path = path;
    connectedClients[this.username].currentSyncSession = this.sessionId;
  }
};

// Terminate a completed sync for a client
Sync.prototype.end = function() {
  if(connectedClients[this.username].currentSyncSession) {
    var that = this;
    rsync.sourceList(this.fs, this.path, rsyncOptions, function(err, srcList) {
      var response;
      if(err) {
        response = SyncMessage.error.srclist;
        response.content = {error: err};
      } else {
        response = SyncMessage.request.chksum;
        response.content = {srcList: srcList, path: that.path};
      }
      that.lastContact = null;
      broadcastUpdate(that.username, response);
      delete connectedClients[that.username].currentSyncSession;
    });
  }
};

// Terminate an incomplete sync for a client
Sync.prototype.kill = function() {
  var currentSync = connectedClients[this.username].currentSyncSession;
  if(currentSync === this.sessionId) {
    this.lastContact = null;
    this.state = Sync.LISTENING;
    delete connectedClients[this.username].currentSyncSession;
  }
};

// Can the client begin an upstream sync if
// there is no other sync in progress for that username
Sync.prototype.canSync = function() {
  return connectedClients[this.username] &&
    !(connectedClients[this.username].currentSyncSession);
};

// Handle a message sent by the client
Sync.prototype.messageHandler = function(data) {
  data = SyncMessage.parse(data);

  if(data.is.request) {
    handleRequest.call(this, data);
  } else if(data.is.response) {
    handleResponse.call(this, data);
  } else {
    this.socket.send(Sync.error.type.stringify());
  }
};

// Store the socket for the current client
Sync.prototype.setSocket = function(ws) {
  this.socket = ws;
};

// Close event for a sync
Sync.prototype.onClose = function() {
  var username = this.username;
  var id = this.sessionId;
  return function() {
    delete connectedClients[username][id];

    // Also remove the username from the list if there are no more connected clients.
    if(Object.keys(connectedClients[username]).length === 0) {
      delete connectedClients[username];
      filesystem.clearCache( username );
    }
  };
};

// Check in with the client to validate syncs
Sync.prototype.clearUpstreamSync = function() {
  var user = connectedClients[this.username];
  var syncingClientId = user && user.currentSyncSession;

  if (user && syncingClientId) {
    var syncingClient = user[syncingClientId].sync;

    var now = Date.now();
    if (now - syncingClient.lastContact > CLIENT_TIMEOUT_MS) {
      syncingClient.kill();
    }
  }
};

// Used to keep track of the last time a message was received from
// the client during an upstream sync. By comparing Date.now() to
// lastContact, we can determine if a sync should be unlocked.
Sync.prototype.updateLastContact = function() {
  this.lastContact = Date.now();
};

/**
 * Public static objects/methods
 */
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

// Create a new sync object for the client
Sync.create = function(username, sessionId){
  return new Sync(username, sessionId);
};

/**
 * Exports
 */
module.exports = Sync;
