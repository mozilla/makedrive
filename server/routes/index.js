// Expose internals
var middleware = require( '../middleware.js' ),
    env = require('../lib/environment'),
    version = require('../../package.json').version,
    FilerWebServer = require('../lib/filer-www'),
    Sync = require( '../lib/sync'),
    SyncMessage = require('../../lib/syncmessage'),
    WebSocketServer = require('ws').Server,
    websocketAuth = require('../lib/websocket-auth');

module.exports = function createRoutes( app, webmakerAuth ) {

  app.get( "/", function( req, res ) {
    res.send( "MakeDrive: https://wiki.mozilla.org/Webmaker/MakeDrive" );
  });

  app.post( "/verify", webmakerAuth.handlers.verify );
  app.post( "/authenticate", webmakerAuth.handlers.authenticate );
  app.post( "/create", webmakerAuth.handlers.create );
  app.post( "/logout", webmakerAuth.handlers.logout );
  app.post( "/check-username", webmakerAuth.handlers.exists );

  function setupWWWRoutes(route, options) {
    app.get(route, middleware.authenticationHandler, function( req, res ) {
      var username = req.params.username;
      var path = '/' + req.params[0];

      var server = new FilerWebServer(username, res, options);
      server.handle(path);
    });
  }

  /**
   * Serve a path from a user's Filer filesystem
   */
  if(env.get('ENABLE_PATH_ROUTE')) {
    setupWWWRoutes('/p/*');
  }

  /**
   * Serve a path as JSON (for APIs) from a user's Filer filesystem
   */
  if(env.get('ENABLE_JSON_ROUTE')) {
    setupWWWRoutes('/j/*', {json: true});
  }

  /**
   * Serve a path as a .zip (for export) from a user's Filer filesystem
   */
  if(env.get('ENABLE_ZIP_ROUTE')) {
    setupWWWRoutes('/z/*', {zip: true});
  }

  app.get( "/api/sync", middleware.crossOriginHandler, middleware.authenticationHandler, function( req, res ) {
    var username = req.params.username;
    var token = websocketAuth.generateTokenForClient(username);

    res.json(200, token);
  });

  /**
   * Server-to-Server Basic AUTH route for getting paths for a user
   */
  if(env.get('BASIC_AUTH_USERS')) {
    app.get('/api/get', middleware.basicAuthHandler, function(req, res) {
      var username = req.params.username;
      var path = req.params.path;

      if(!username) {
        return res.json(400, {error: 'Missing username param'});
      }
      if(!path) {
	return res.json(400, {error: 'Missing username param'});
      }

      var server = new FilerWebServer(username, res, {json: true});
      server.handle(path);
    });
  }

  app.get( "/healthcheck", function( req, res ) {
    res.json({
      http: "okay",
      version: version
    });
  });
};
