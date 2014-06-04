/**
 * Sync() module for creating and managing syncs
 * between client and server
 */

var env = require( "../lib/environment" ),
    filesystem = require( "../lib/filesystem" ),
    uuid = require( "node-uuid" ),
    emiter = new ( require( "events" ).EventEmitter )();

var rsync = require( "../lib/rsync" );

/**
 * Static public variables
 */

// Constants for each state of the sync process
Sync.CONNECTED = 1;
Sync.STARTED = 2;
Sync.FILE_IDENTIFICATION = 3;
Sync.CHECKSUMS = 4;
Sync.DIFFS = 5;
Sync.ENDED = 6;

/**
 * Static private variables
 */
var syncTable = {},
    connectedClients = {},
    // TODO: Examine these. Are they what we need?
    rsyncOptions = {
      size: 5,
      links: false,
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
    onOutOfDate: onOutOfDate
  };
  emitter.addListener( "updateToLatestSync", onOutOfDate );

  this.state = this.CONNECTED;
}

// Plug into this user's server-side filesystem,
// formally starting the sync process
Sync.prototype.start = function( callback ) {
  var that = this;
  var fs = that.fs = filesystem.create({
    keyPrefix: that.username
  });

  syncTable[ username ] = {
    syncId: that.syncId
  };

  // TODO: Decide what our root path will be (currently /projects)
  fs.mkdir("/projects", function( err ) {
    if ( err ) {
      return callback( "Error creating the user's root directory: " + err );
    }

    syncTable[ that.username ] = {
      syncId: that.id
    };

    that.state = Sync.STARTED;
    callback( null, that.id );
  });
};

Sync.prototype.end = function() {
  this.state = Sync.ENDED;
  delete syncTable[ this.username ];
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

  // TODO: Swap this out for Ali's solution to this problem
  // Parse JSON diffs to Uint8Array
  var i, j, k;
  for (i = 0; i < diffs.length; i++) {
    if(diffs[i].contents) {
      for (j = 0; j < diffs[i].contents.length; j++) {
        for (k = 0; k < diffs[i].contents[j].diff.length; k++) {
          if (diffs[i].contents[j].diff[k].data) {
            diffs[i].contents[j].diff[k].data = diffs[i].contents[j].diff[k].data;
            // Deal with special-cased flattened typed arrays in WebSQL (see put() below)
            if (diffs[i].contents[j].diff[k].data.__isUint8Array) {
              diffs[i].contents[j].diff[k].data = new Uint8Array(diffs[i].contents[j].diff[k].data.__array);
            }
          }
        }
      }
    } else {
      for (k = 0; k < diffs[i].diff.length; k++) {
        if (diffs[i].diff[k].data) {
          diffs[i].diff[k].data = diffs[i].diff[k].data;
          // Deal with special-cased flattened typed arrays in WebSQL (see put() below)
          if (diffs[i].diff[k].data.__isUint8Array) {
            diffs[i].diff[k].data = new Uint8Array(diffs[i].diff[k].data.__array);
          }
        }
      }
    }
  }

  rsync.patch( that.fs, that.path, diffs, rsyncOptions, function ( err, data ) {
    if ( err ) {
      return callback( err );
    }

    that.state = Sync.DIFFS;

    callback();
    emitter.emit( "updateToLatestSync", that.syncId, req.param("syncId") );
  });
};

Sync.prototype.onClose = function() {
  emitter.removeListener( "updateToLatestSync", connectedClients[ this.username ][ this.syncId ].onOutOfDate );
  delete connectedClients[ this.username ][ this.syncId ];
};

/**
 * Public static methods
 */
Sync.active = {
  checkUser: checkUser,
  isSyncSession: isSyncSession
};
Sync.connections = {
  doesIdMatchUser: function( id, username ){
    return id in connectedClients[ username ];
  }
};
Sync.create = function( username, id ){
  if ( syncTable[ username ] ) {
    throw( "Error! " + username + " already has a sync in progress!" );
  }

  return new Sync( username, id );
};
Sync.setPath = function( path ){
  // TODO: Add path validation logic
  // If invalid, throw("Invalid path");
  this.path = path;

  // Do we have all the data we need?
  if ( this.srcList ) {
    this.state = Sync.FILE_IDENTIFICATION;
  }
};
Sync.setSrcList = function( srcList ){
  // TODO: Add srcList validation logic
  // If invalid, throw("Invalid srcList");
  this.srcList = srcList;

  // Do we have all the data we need?
  if ( this.path ) {
    this.state = Sync.FILE_IDENTIFICATION;
  }
};
Sync.kill = function( username ) {
  if ( username in syncTable ) {
    delete syncTable[ username ];
  }
};

/**
 * Exports
 */
module.exports = Sync;
