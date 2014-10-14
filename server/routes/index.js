// Expose internals
var middleware = require('../middleware.js');
var env = require('../lib/environment');
var version = require('../../package.json').version;
var FilerWebServer = require('../lib/filer-www');
var WebsocketAuth = require('../lib/websocket-auth');

module.exports = function createRoutes(app) {

  app.get( "/", function( req, res ) {
    res.send( "MakeDrive: https://wiki.mozilla.org/Webmaker/MakeDrive" );
  });

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
    var token = WebsocketAuth.generateTokenForClient(username);

    res.json(200, token);
  });

  /**
   * Server-to-Server Basic AUTH route for getting paths for a user
   */
  if(env.get('BASIC_AUTH_USERS')) {
    app.get('/s/:username/*', middleware.basicAuthHandler, function(req, res) {
      var username = req.params.username;
      var path = '/' + req.params[0];

      if(!username) {
        return res.json(400, {error: 'Missing username param'});
      }
      if(!path) {
        return res.json(400, {error: 'Missing path'});
      }

      var server = new FilerWebServer(username, res, {raw: true});
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
