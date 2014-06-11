/**
 * Sync() module for creating and managing syncs
 * between client and server
 */

var env = require( "./environment" ),
    filesystem = require( "./filesystem" ),
    uuid = require( "node-uuid" ),
    emitter = new ( require( "events" ).EventEmitter )(),
    SyncMessage = require( "./syncmessage" );

var rsync = require( "./rsync" );

/**
 * Static public variables
 */

// Constants for each state of the upstream sync process
Sync.CONNECTED = 1;
Sync.STARTED = 2;
Sync.FILE_IDENTIFICATION = 3;
Sync.CHECKSUMS = 4;
Sync.DIFFS = 5;
Sync.ENDED = 6;

// Constants for downstream sync process
Sync.SRCLIST = 7;
Sync.CHECKSUM = 8;
Sync.DIFF = 9;
Sync.WSCON = 10;

/**
 * Static private variables
 */
var syncTable = {},
    connectedClients = {},
    // TODO: Examine these. Are they what we need?
    rsyncOptions = {
      size: 5,
      time: true,
      recursive: true
    };

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

function u8toArray(u8) {
  var array = [];
  var len = u8.length;
  for (var i = 0; i < len; i++) {
    array[i] = u8[i];
  }
  return array;
}

function convertDiffs( diffs ) {
  var i, j, k;
  for (i = 0; i < diffs.length; i++) {
    if (diffs[i].contents) {
      for (j = 0; j < diffs[i].contents.length; j++) {
        for (k = 0; k < diffs[i].contents[j].diffs.length; k++) {
          if (Object.prototype.toString.call(diffs[i].contents[j].diffs[k].data) === "[object Uint8Array]") {
            diffs[i].contents[j].diffs[k].data = {
              __isUint8Array: true,
              __array: u8toArray(diffs[i].contents[j].diffs[k].data)
            };
          }
        }
      }
    } else {
      for (k = 0; k < diffs[i].diffs.length; k++) {
        if (Object.prototype.toString.call(diffs[i].diffs[k].data) === "[object Uint8Array]") {
          diffs[i].diffs[k].data = {
            __isUint8Array: true,
            __array: u8toArray(diffs[i].diffs[k].data)
          };
        }
      }
    }
  }
  return diffs;
}

/**
 * Constructor
 */
function Sync( username, onOutOfDate ) {
  var id = this.syncId = uuid.v4();
  this.username = username;

  // Ensure the current user exists in our datastore and
  // track this client session keyed by a new `syncId`
  if (!connectedClients[username]) {
    connectedClients[username] = {};
  }
  connectedClients[username][id] = {
    onOutOfDate: onOutOfDate,
    sync: this
  };
  emitter.addListener( "updateToLatestSync", onOutOfDate );
  this.fs = filesystem.create({
    keyPrefix: this.username,
    name: this.username
  });
  var that = this;
  // TODO: Decide what our root path will be (currently /projects)
  this.fs.mkdir("/projects", function( err ) {
    if ( err && err.code !== 'EEXIST' ) {
      console.err( "Error creating the user's root directory: " + err );
    }
    that.state = Sync.CONNECTED;
    that.path = '/projects';
  });
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
  if(!data || !data.content) {
    return this.socket.send(Sync.socket.errors.EUNDEF);
  }
  // TODO: validate that the message sent is a SyncMessage

  var res;

  if(data.type === SyncMessage.REQUEST) {

    if(data.name === SyncMessage.SOURCE_LIST) {
      if(this.socketState !== Sync.WSCON && this.socketState !== Sync.SRCLIST) {
        return this.socket.send(Sync.socket.errors.ESTATE);
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
        return this.socket.send(Sync.socket.errors.ESTATE);
      }
      if(typeof data.content !== 'object') {
        return this.socket.send(Sync.socket.errors.EINVDT);
      }
      var checksums;
      checksums = data.content.checksums;
      return rsync.diff(this.fs, this.path, checksums, rsyncOptions, function(err, diffs) {
        if(err) {
          res = Sync.socket.errors.custom('EDIFFS', err);
        } else {
          res = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.DIFF);
          res.setContent({diffs: convertDiffs(diffs), path: that.path});
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

Sync.prototype.addSocket = function( ws ) {
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
Sync.create = function( username, onOutOfDate ){
  if ( syncTable[ username ] ) {
    throw( "Error! " + username + " already has a sync in progress!" );
  }

  return new Sync( username, onOutOfDate );
};
Sync.kill = function( username ) {
  if ( username in syncTable ) {
    delete syncTable[ username ];
  }
};
Sync.retrieve = function( username, syncId ) {
  // Parameter handling
  if ( !syncId && username ) {
    syncId = username;
    username = null;
  }

  // Better performance if we have both parameters
  if ( username ) {
    if ( !connectedClients[ username ] || !connectedClients[ username ][ syncId ] ) {
      return null;
    }

    return connectedClients[ username ][ syncId ].sync;
  }

  var client,
      keys = Object.keys(connectedClients);

  for (var i = 0; i < keys.length; i++) {
    client = connectedClients[ keys[i] ][ syncId ];

    if ( client ) {
      return client.sync;
    }
  }
  return null;
};

/**
 * Exports
 */
module.exports = Sync;
