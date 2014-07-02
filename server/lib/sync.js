/**
 * Sync() module for creating and managing syncs
 * between client and server
 */

var env = require( "./environment" ),
    filesystem = require( "./filesystem" ),
    uuid = require( "node-uuid" ),
    emitter = new ( require( "events" ).EventEmitter )(),
    Buffer = require('filer').Buffer,
    SyncMessage = require( "./syncmessage" );

var rsync = require( "../../lib/rsync" ),
    serializeDiff = require('../../lib/diff').serialize,
    rsyncOptions = require( "../../lib/constants" ).rsyncDefaults;

/**
 * Static public variables
 */

// Constants for each state of the upstream sync process
Sync.CONNECTED = "CONNECTED";
Sync.STARTED = "STARTED";
Sync.FILE_IDENTIFICATION = "FILE_IDENTIFICATION";
Sync.CHECKSUMS = "CHECKSUMS";
Sync.DIFFS = "DIFFS";
Sync.ENDED = "ENDED";

// Constants for downstream sync process
Sync.SRCLIST = "SRCLIST";
Sync.CHECKSUM = "CHECKSUM";
Sync.DIFF = "DIFF";
Sync.WSCON = "WSCON";

/**
 * Static private variables
 */
var syncTable = {},
    connectedClients = {};

/**
 * Helper functions
 */

function checkUser( username ) {
  return !!syncTable[ username ];
}

function isSyncSession( username, id ) {
  return checkUser( username ) && syncTable[ username ].syncId === id;
}

function checkData( sync ) {
  if ( !sync.fs ) {
    return "This sync hasn't started! start() must be called first.";
  }

  if ( !sync.path ) {
    return "This sync data hasn't been set! setPath() & setSrcList() must be called first.";
  }

  if ( !sync.srcList ) {
    return "This sync data hasn't been set! setPath() & setSrcList() must be called first.";
  }
  return null;
}

function createError(code, message) {
  var error = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ERROR);
  error.setContent({state: code, message: message});
  return error;
}

/**
 * Constructor
 */
function Sync( username, sessionId ) {
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
    keyPrefix: this.username,
    name: this.username
  });
  this.state = Sync.CONNECTED;
  this.path = '/';
}

// Plug into this user's server-side filesystem,
// formally starting the sync process
Sync.prototype.start = function( callback ) {
  var that = this;

//  var fs = that.fs = filesystem.create({
//    keyPrefix: that.username,
//    name: that.username
//  });

  syncTable[ that.username ] = {
    syncId: that.syncId
  };

  that.state = Sync.STARTED;
  callback( null, that.syncId );
};

Sync.prototype.end = function() {
  this.state = Sync.ENDED;
  delete syncTable[ this.username ];
  emitter.emit( "updateToLatestSync", this.syncId, this.syncId );
};

Sync.prototype.generateChecksums = function( callback ) {
  var that = this;

  var err = checkData( that );
  if ( err ) {
    callback( err );
  }

  rsync.checksums(that.fs, that.path, that.srcList, rsyncOptions, function( err, checksums ) {
    if ( err ) {
      return callback( err );
    }

    that.state = Sync.CHECKSUMS;
    callback( null, checksums );
  });
};

Sync.prototype.patch = function( diffs, callback ) {
  var that = this;

  var err = checkData( this );
  if ( err ) {
    callback( err );
  }
  // Fail loudly if the server allows this method to be called
  // without passing diffs
  // TODO: Add diff validation logic
  if ( !diffs ) {
    callback( "Diffs must be passed" );
  }
  var i, j, k;

  rsync.patch( that.fs, that.path, diffs, rsyncOptions, function ( err, data ) {
    if ( err ) {
      return callback( err );
    }

    that.state = Sync.DIFFS;

    callback();
  });
};

Sync.prototype.onClose = function( ) {
  var sync = this;
  return function() {
    emitter.removeListener( "updateToLatestSync", connectedClients[ sync.username ][ sync.syncId ].onOutOfDate );
    delete connectedClients[ sync.username ][ sync.syncId ];
  };
};

Sync.prototype.setPath = function( path ){
  // TODO: Add path validation logic
  // If invalid, throw("Invalid path");
  this.path = path;

  // Do we have all the data we need?
  if ( this.srcList ) {
    this.state = Sync.FILE_IDENTIFICATION;
  }
};

Sync.prototype.setSrcList = function( srcList ){
  // TODO: Add srcList validation logic
  // If invalid, throw("Invalid srcList");
  this.srcList = srcList;

  // Do we have all the data we need?
  if ( this.path ) {
    this.state = Sync.FILE_IDENTIFICATION;
  }
};

Sync.prototype.messageHandler = function( data ) {
  var that = this;
  if (typeof data !== "object" || !data.content && !data.type){
    var errorMessage = Sync.socket.errors.EINVAL;
    return this.socket.send(JSON.stringify(Sync.socket.errors.EINVAL));
  }
  if(!data.content) {
    return this.socket.send(JSON.stringify(Sync.socket.errors.EINVDT));
  }

  var res;
  if(data.type === SyncMessage.REQUEST) {
    if(data.name === SyncMessage.SOURCE_LIST) {
      if(this.socketState !== Sync.WSCON && this.socketState !== Sync.SRCLIST) {
        return this.socket.send(JSON.stringify(Sync.socket.errors.ESTATE));
      }

      return rsync.sourceList(this.fs, this.path, rsyncOptions, function(err, srcList) {
        if(err) {
          res = Sync.socket.errors.custom('ESRCLS', err);
        } else {
          res = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.SOURCE_LIST);
          res.setContent({srcList: srcList, path: that.path});
          that.socketState = Sync.SRCLIST;
        }
        that.socket.send(JSON.stringify(res));
      });
    }
    if(data.name === SyncMessage.DIFF) {
      if(this.socketState !== Sync.CHECKSUM && this.socketState !== Sync.DIFF) {
        return this.socket.send(JSON.stringify(Sync.socket.errors.ESTATE));
      }
      if(typeof data.content !== 'object') {
        return this.socket.send(JSON.stringify(Sync.socket.errors.EINVDT));
      }

      var checksums;
      checksums = data.content.checksums;
      return rsync.diff(this.fs, this.path, checksums, rsyncOptions, function(err, diffs) {
        if(err) {
          res = Sync.socket.errors.custom('EDIFFS', err);
        } else {
          res = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.DIFF);
          res.setContent({diffs: serializeDiff(diffs), path: that.path});
          that.socketState = Sync.DIFF;
        }
        that.socket.send(JSON.stringify(res));
      });
    }
    if(data.name === SyncMessage.RESET) {
      this.socketState = Sync.WSCON;
      return this.socket.send(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));
    }

    return this.socket.send(JSON.stringify(Sync.socket.errors.ERQRSC));
  }
  if(data.type === SyncMessage.RESPONSE) {
    if(data.name === SyncMessage.CHECKSUM && this.socketState === Sync.SRCLIST) {
      this.socketState = Sync.CHECKSUM;
      res = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK);
      res.setContent({path: that.path});
      return this.socket.send(JSON.stringify(res));
    }

    if(data.name === SyncMessage.PATCH && this.socketState === Sync.DIFF) {
      this.socketState = Sync.WSCON;
      return this.socket.send(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));
    }

    return this.socket.send(JSON.stringify(Sync.socket.errors.ERSRSC));
  }

  return this.socket.send(JSON.stringify(Sync.socket.errors.ETYPHN));
};

Sync.prototype.setSocket = function( ws ) {
  this.socket = ws;
  this.socketState = Sync.WSCON;
};

/**
 * Public static methods
 */
Sync.active = {
  checkUser: checkUser,
  isSyncSession: isSyncSession
};
Sync.socket = {
  errors: {
    ETYPHN: createError('ETYPHN', 'The Sync message type cannot be handled by the server'),
    EUNDEF: createError('EUNDEF', 'No value provided'),
    EINVDT: createError('EINVDT', 'Invalid content provided'),
    EINVAL: createError('EINVAL', 'Invalid Message Format. Message must be a sync message'),
    ERQRSC: createError('ERQRSC', 'Invalid resource requested'),
    ERSRSC: createError('ERSRSC', 'Resource provided cannot be recognized'),
    ERECOG: createError('ERECOG', 'Message type not recognized'),
    ESTATE: createError('ESTATE', 'Sync in incorrect state'),
    custom: function(code, message) {
      return createError(code, message);
    }
  }
};

Sync.connections = {
  doesIdMatchUser: function( id, username ){
    return id in connectedClients[ username ];
  }
};

Sync.create = function( username, sessionId ){
  return new Sync( username, sessionId );
};

Sync.kill = function( username ) {
  var user;
  if ( username in syncTable ) {
    user = syncTable[ username ]
    delete syncTable[ username ];
  }

  if ( username in connectedClients ) {
    user = connectedClients[ username ];
    user.socket.close();
    user.socketState = null;
  }
};

Sync.retrieve = function( username, sessionId ) {
  if ( !connectedClients[ username ] || !connectedClients[ username ][ sessionId ] ) {
    return null;
  }

  return connectedClients[ username ][ sessionId ].sync;
};

/**
 * Exports
 */
module.exports = Sync;
