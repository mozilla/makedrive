// Expose internals
var middleware = require( './middleware' ),
    env = require('../../lib/environment'),
    version = require('../../../package.json').version,
    FilerWebServer = require('../../lib/filer-www.js'),
    Sync = require( '../lib/sync'),
    ws = require('ws'),
    SyncMessage = require('../lib/syncmessage'),
    WebSocket = require('ws'),
    WebSocketServer = WebSocket.Server,
    websocketAuth = require('../lib/websocket-auth');

module.exports = function createRoutes( app, webmakerAuth  ) {
  // Client-side Webmaker Auth support
  app.post('/verify', webmakerAuth.handlers.verify);
  app.post('/authenticate', webmakerAuth.handlers.authenticate);
  app.post('/logout', middleware.authenticationHandler, websocketAuth.logoutHandler, webmakerAuth.handlers.logout);
  app.post('/create', webmakerAuth.handlers.create);
  app.post('/check-username', webmakerAuth.handlers.exists);

  app.get( "/", function( req, res ) {
    res.send( "MakeDrive: https://wiki.mozilla.org/Webmaker/MakeDrive" );
  });

  app.get( "/p/*", middleware.authenticationHandler, function( req, res ) {
    var username = req.params.username;
    var path = '/' + req.params[0];

    var server = new FilerWebServer(username);
    server.handle(path, res);
  });

  app.get( "/api/sync", middleware.authenticationHandler, function( req, res ) {
    var username = req.params.username;
    var id = req.params.sessionId;

    res.json(200, websocketAuth.generateTokenForSession(username, id));
  });

  app.get( "/healthcheck", function( req, res ) {
    res.json({
      http: "okay",
      version: version
    });
  });
};
