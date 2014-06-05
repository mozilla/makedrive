// Expose internals
var middleware = require( './middleware' ),
    routes = require( './routes' ),
    Sync = require( '../lib/sync');

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
console.log('here')
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
    req.on("close", sync.onClose);
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
        sync = req.session.sync;

    if ( Sync.active.checkUser( username ) ) {
      return res.json(423, {
        error: 'A sync with this user is already in progress'
      });
    }

    if ( !Sync.connections.doesIdMatchUser( req.param( 'connectionId' ), username ) ) {
      return res.json(400, { message: "User/client missmatch: connectionId doesn't match user!" });
    }

    sync.start(function( err, id ) {
      if ( err ) {
        return res.json( 500, err );
      }

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
  app.post('/api/sync/:syncId/sources', middleware.authenticationHandler, middleware.validateSync( Sync.CONNECTED ), function (req, res) {
    var sync = req.session.sync;

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

    try {
      sync.setPath( path );
      sync.setSrcList( srcList );
    } catch( e ) {
      return res.json(415, { message: e });
    }

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
    var sync = req.session.sync;

    sync.generateChecksums(function( err, checksums ) {
      if ( err ) {
        sync.end();
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
    var sync = req.session.sync;

    if (!req.body) {
      return res.json(400, { message: "No data passed! Diffs required!" });
    }

    var diffs = req.body.diffs;
    if (!diffs) {
      return res.json(400, { message: "Diffs must be passed!" });
    }

    sync.patch( diffs, function( err ) {
      if ( err ) {
        sync.end();
        delete req.session.sync;
        return res.json(500, { message: "Ending sync! Fatal error while patching: " + err });
      }

      return res.json(200);
    });
  });

  app.get( "/healthcheck", routes.healthcheck );
};
