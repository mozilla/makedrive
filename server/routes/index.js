// Expose internals
var middleware = require( './middleware' ),
    routes = require( './routes' ),
    Sync = require( '../lib/sync'),
    util = require( '../lib/util' ),
    formidable = require('formidable');

// TODO: Factor route groupings into their own files,
//       build a system to require them here
module.exports = function createRoutes( app ) {
  app.get( "/", routes.index );
  app.get( "/p/*", middleware.authenticationHandler, routes.retrieveFiles );

  /**
   * [SSE Socket]
   * Establishes an SSE connection with the client, and
   * generates a UUID (the `connectionId`) for this particular
   * client session of the currently signed-in user.
   */
  app.get( "/api/sync/updates", middleware.authenticationHandler, function( req, res ) {
    var username = req.params.username;

    // Send an out of date message to all clients except
    // the one that just sync'd new changes
    var onOutOfDate = function( id ) {
      if (sync.syncId != id) {
        res.write("data: " + 'You are out of date! Sync from source to update current session.' + '\n\n');
      }
    };

    // Create this client's connection
    var sync = req.session.sync = Sync.create( username, onOutOfDate );

    // let request last as long as possible
    req.socket.setTimeout( Infinity );

    // Send headers for event-stream connection
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Content-Encoding': 'zlib',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');

    // Immediately send the connectionId for client use
    var data = {
      syncId: sync.syncId
    };
    res.write("data: " + JSON.stringify(data) + "\n\n");

    // When the socket closes, remove the client from the datastore
    req.on("close", sync.onClose());
  });

  /**
   * [1st] step in the UPSTREAM sync process
   *   NOTE: Requires the [SSE Socket] connection
   *
   * Establishes a particular client session (represented by
   * the `connectionId` parameter) as doing a sync for the signed-in user, and
   * rejects all other client sessions for that user from attempting
   * to sync until it is complete.
   *
   * :connectionId - the `connectionId` /api/sync/updates generated for this
   *                 client
   */
  app.get('/api/sync/:connectionId', middleware.authenticationHandler, function (req, res) {
    var username = req.params.username,
        sync = Sync.retrieve( username, req.param( 'connectionId' ) );

    if ( Sync.active.checkUser( username ) ) {
      return res.json(423, {
        error: 'A sync with this user is already in progress'
      });
    }

    if ( !Sync.connections.doesIdMatchUser( req.param( 'connectionId' ), username ) ) {
      return res.json(400, { message: "User/client missmatch: connectionId doesn't match user!" });
    }
console.log('Trying to start sync session ' + sync.id);
    sync.start(function( err, id ) {
      if ( err ) {
        console.error('sync.start error: ' + err);
        return res.json( 500, err );
      }

      console.log('started sync session for ' + username + ' syncID ' + id);
      res.json(200, {
        syncId: id
      });
    });
  });

  /**
   * [2nd] step in the UPSTREAM sync process
   * Posts a `sourceList` of the source (client) filesystem
   *
   * :syncId - the `syncId` for this user
   */
  app.post('/api/sync/:syncId/sources', middleware.authenticationHandler, middleware.validateSync( Sync.STARTED ), function (req, res) {
    var username = req.params.username,
        sync = req.params.sync;

    if (!req.body) {
      return res.json(400, { message: "No data received! Path and srcList are required!" });
    }

    var path = req.body.path;
    if (!path) {
      return res.json(400, { message: "Path is required!" });
    }

    var srcList = req.body.srcList;
    if (!srcList) {
      return res.json(400, { message: "srcList is required!" });
    }

    sync.setPath( path );
    sync.setSrcList( srcList );


    res.json( 201 );
  });

  /**
   * [3rd] step in the UPSTREAM sync process
   * GETs checksums representing the destination (server) filesystem
   *
   * :syncId - the `connectionId` /api/sync/updates generated for this
   *           client
   */
  app.get('/api/sync/:syncId/checksums', middleware.authenticationHandler, middleware.validateSync( Sync.FILE_IDENTIFICATION ), function (req, res) {
    var sync = req.params.sync;

    sync.generateChecksums(function( err, checksums ) {
      if ( err ) {
        sync.end();
        console.error('/api/sync/:syncId/checksums error: ' + err);
        delete req.session.sync;
        return res.json(500, { message: "Ending sync! Fatal error generating checksums: " + err });
      }
      res.json(200, { checksums: checksums });
    });
  });

  /**
   * [4th] step in the UPSTREAM sync process
   * PUTs the checksum diffs to the destination (server) filesystem
   *
   * :syncId - the `connectionId` /api/sync/updates generated for this
   *           client
   */
  app.put('/api/sync/:syncId/diffs', middleware.authenticationHandler, middleware.validateSync( Sync.CHECKSUMS ), function (req, res) {
    var sync = req.params.sync;

    var chunks = [],
        diffs;

    var form = new formidable.IncomingForm();
    // formidable handle parsing from request
    form.parse(req);
    form.onPart = function(part) {
      if (!part.filename) {
        part.addListener('data', function(data) {
          diffs = JSON.parse(data);
        });
        // let formidable handle all non-file parts
        form.handlePart(part);
      } else {
        part.addListener('data', function(data) {
          // Parse JSON diffs to Uint8Array
          for (var i = 0; i < diffs.length; i++) {
            if(diffs[i].contents) {
              for (var j = 0; j < diffs[i].contents.length; j++) {
                for (var k = 0; k < diffs[i].contents[j].diff.length; k++) {
                  if (diffs[i].contents[j].diff[k].data) {
                    diffs[i].contents[j].diff[k].data = util.toArrayBuffer(data);
                  }
                }
              }
            } else {
              for (var k = 0; k < diffs[i].diff.length; k++) {
                if (diffs[i].diff[k].data) {
                  diffs[i].diff[k].data = util.toArrayBuffer(data);
                }
              }
            }
          }

        });
      }
    }

    form.on('end', function() {
      sync.patch( diffs, function( err ) {
        sync.end();
        if ( err ) {
          console.error('/api/sync/:syncId/diffs error: ' + err);
          return res.json(500, { message: "Ending sync! Fatal error while patching: " + err });
        }
        return res.json(200);
      });
    });
  });

  app.get( "/healthcheck", routes.healthcheck );
};
