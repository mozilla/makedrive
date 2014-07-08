/**
 * Sync() module for creating and managing syncs
 * between client and server
 */
var filesystem = require( "./filesystem" ),
    SyncMessage = require('../../lib/syncmessage'),
    MsgErrors = SyncMessage.errors,
    InternalError = SyncMessage.generateError,
    rsync = require('../../lib/rsync'),
    diffHelper = require('../../lib/diff'),
    rsyncOptions = require('../../lib/constants').rsyncDefaults;

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

  function sendSrcList() {
    rsync.sourceList(that.fs, '/', rsyncOptions, function(err, srcList) {
      if(err) {
        response = SyncMessage.error.srclist;
        response.setContent(err);
      } else {
        response = SyncMessage.request.chksum;
        response.setContent({srcList: srcList, path: '/'});
      }
      that.socket.send(response.stringify());
    });
  }

  function resetUpstream() {
    that.end();
    that.state = Sync.LISTENING;
  }

  function handleDiffRequest() {
    if(!data.content.checksums) {
      return that.socket.send(JSON.stringify(MsgErrors.INCONT));
    }

    var checksums = data.content.checksums;

    rsync.diff(that.fs, that.path, checksums, rsyncOptions, function(err, diffs) {
      if(err) {
        response = SyncMessage.error.diffs;
        response.setContent(err);
      } else {
        response = SyncMessage.response.diffs;
        response.setContent({diffs: diffHelper.serialize(diffs), path: that.path});
      }
      that.socket.send(response.stringify());
    });
  }

  function handleSyncInitRequest() {
    if(that.canSync()) {
      response = SyncMessage.response.sync;
      that.state = Sync.CHKSUM;
      that.init();
    } else {
      response = SyncMessage.error.locked;
    }
    that.socket.send(response.stringify());
  }

  function handleChecksumRequest() {
    if(!data.content.srcList || !data.content.path) {
      return that.socket.send(JSON.stringify(MsgErrors.INCONT));
    }

    var srcList = data.content.srcList;
    var path = data.content.path;

    rsync.checksums(that.fs, path, srcList, rsyncOptions, function(err, checksums) {
      if(err) {
        that.state = Sync.LISTENING;
        that.end();
        response = SyncMessage.error.chksum;
        response.setContent(err);
      } else {
        response = SyncMessage.request.diffs;
        response.setContent({checksums: checksums, path: that.path});
        that.state = Sync.PATCH;
      }
      that.socket.send(response.stringify());
    });
  }

  if(data.name === SyncMessage.RESET && that.state === Sync.OUT_OF_DATE) {
    sendSrcList();
  } else if(data.name === SyncMessage.RESET && that.state !== Sync.OUT_OF_DATE) {
    resetUpstream();
  } else if(data.name === SyncMessage.DIFFS && that.state === Sync.OUT_OF_DATE) {
    handleDiffRequest();
  } else if(data.name === SyncMessage.SYNC && that.state === Sync.LISTENING) {
    handleSyncInitRequest();
  } else if(data.name === SyncMessage.CHKSUM && that.state === Sync.CHKSUM) {
    handleChecksumRequest();
  } else {
    that.socket.send(JSON.stringify(Sync.errors.ERQRSC));
  }
}

// Handle responses sent by the client
function handleResponse(data) {
  var that = this;
  var response;

  function handleDiffResponse() {
    if(!data.content.diffs) {
      return that.socket.send(JSON.stringify(MsgErrors.INCONT));
    }

    var diffs = diffHelper.deserialize(data.content.diffs);
    var path = data.content.path;
    that.state = Sync.LISTENING;
    rsync.patch(that.fs, path, diffs, rsyncOptions, function(err) {
      if(err) {
        that.end();
        return SyncMessage.error.patch;
      }
      response = SyncMessage.response.patch;
      that.socket.send(response.stringify());
      that.end();
    });
  }

  function handlePatchResponse() {
    // TODO: Figure out how to make sure that the client actually patched successfully
    // before changing the server's state to allow upstream syncs from that client
    // https://github.com/mozilla/makedrive/issues/32
    that.state = Sync.LISTENING;
  }

  if(data.name === SyncMessage.DIFFS && that.state === Sync.PATCH) {
    handleDiffResponse();
  } else if(data.name === SyncMessage.PATCH && that.state === Sync.OUT_OF_DATE) {
    handlePatchResponse();
  } else {
    that.socket.send(JSON.stringify(Sync.errors.ERSRSC));
  }
}

// Broadcast an out-of-date message to the clients
// after an upstream sync process has completed
function broadcastUpdate(username) {
  var clients = connectedClients[username];
  var currSyncingClient = clients.currentSyncSession;
  var updateMsg = SyncMessage.request.chksum.stringify();
  var outOfDateClient;
  if(clients) {
    for(var sessionId in clients) {
      if(currSyncingClient !== sessionId) {
        outOfDateClient = clients[sessionId].sync;
        outOfDateClient.state = Sync.OUT_OF_DATE;
        outOfDateClient.socket.send(updateMsg);
      }
    }
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
Sync.prototype.init = function() {
  if(!(connectedClients[this.username].currentSyncSession)) {
    connectedClients[this.username].currentSyncSession = this.sessionId;
  }
};

Sync.prototype.onClose = function( ) {
  var username = this.username;
  var id = this.syncId;

  return function() {
    emitter.removeListener( "updateToLatestSync", connectedClients[ username ][ id ].onOutOfDate );
    delete connectedClients[ username ][ id ];

    // Also remove the username from the list if there are no more connected clients.
    if( Object.keys( connectedClients[ username ] ).count === 0 ) {
      delete connectedClients[ username ];
    }
  };
};

// Terminate a sync for a client
Sync.prototype.end = function() {
  if(connectedClients[this.username].currentSyncSession) {
    broadcastUpdate(this.username);
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
  if (typeof data !== "object" || !data.content || !data.type || !data.name) {
    return this.socket.send(JSON.stringify(MsgErrors.INFRMT));
  }

  if(data.type === SyncMessage.REQUEST) {
    handleRequest.call(this, data);
  } else if(data.type === SyncMessage.RESPONSE) {
    handleResponse.call(this, data);
  } else {
    this.socket.send(JSON.stringify(Sync.errors.ETYPHN));
  }
};

// Store the socket for the current client
Sync.prototype.setSocket = function(ws) {
  this.socket = ws;
};

// Close event for a sync
Sync.prototype.onClose = function() {
  var username = this.username;
  var id = this.syncId;

  return function() {
    delete connectedClients[username][id];

    // Also remove the username from the list if there are no more connected clients.
    if(Object.keys(connectedClients[username]).count === 0) {
      delete connectedClients[username];
    }
  };
};

/**
 * Public static objects/methods
 */
Sync.errors = {
  ETYPHN: InternalError('The Sync message cannot be handled by the server'),
  ERQRSC: InternalError('Request cannot be processed'),
  ERSRSC: InternalError('Resource provided cannot be processed'),
};

// Create a new sync object for the client
Sync.create = function(username, sessionId){
  return new Sync(username, sessionId);
};

/**
 * Exports
 */
module.exports = Sync;
