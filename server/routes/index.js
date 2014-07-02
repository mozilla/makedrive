// Expose internals
var middleware = require( './middleware' ),
    routes = require( './routes' ),
    Sync = require( '../lib/sync'),
    formidable = require('formidable'),
    Buffer = require('filer').Buffer,
    ws = require('ws'),
    SyncMessage = require('../lib/syncmessage'),
    WebSocket = require('ws'),
    WebSocketServer = WebSocket.Server,
    websocketAuth = require('../lib/websocket-auth');

// TODO: Factor route groupings into their own files,
//       build a system to require them here
module.exports = function createRoutes( app, webmakerAuth  ) {
  // Client-side Webmaker Auth support
  app.post('/verify', webmakerAuth.handlers.verify);
  app.post('/authenticate', webmakerAuth.handlers.authenticate);
  app.post('/logout', middleware.authenticationHandler, websocketAuth.logoutHandler, webmakerAuth.handlers.logout);
  app.post('/create', webmakerAuth.handlers.create);
  app.post('/check-username', webmakerAuth.handlers.exists);

  app.get( "/", routes.index );
  app.get( "/p/*", middleware.authenticationHandler, routes.servePath );
  app.get( "/api/sync", middleware.authenticationHandler, routes.generateToken );

  app.get( "/healthcheck", routes.healthcheck );
};
