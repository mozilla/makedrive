var Sync = require('../../lib/sync');
var websocketAuth = require('../../lib/websocket-auth');

function generateError( code, msg ) {
  var err = new Error( msg );
  err.status = code;
  return err;
}

module.exports = {
  authenticationHandler: function( req, res, next ) {
    var username = req.session && req.session.user && req.session.user.username;
    if ( !username ) {
      return next( generateError( 401, "Webmaker Authentication Required." ) );
    }

    req.session.sessionId = websocketAuth.createSessionTracker(username, req.session.sessionId);

    req.params.username = username;
    req.params.sessionId = req.session.sessionId;
    next();
  },
  crossOriginHandler: function( req, res, next ) {
    res.header( "Access-Control-Allow-Origin", "*" );
    next();
  }
};
