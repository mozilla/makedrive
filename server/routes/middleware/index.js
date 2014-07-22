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
    
    // If cookie session ain't present, see if data got passed in via query string
    if ( !username ) {
      if(req.query.username){
        username = req.query.username;
      }
      else {
        return next( generateError( 401, "Webmaker Authentication Required." ) );
      }
    }
    
    req.session.sessionId = websocketAuth.createSessionTracker(username, req.session.sessionId);
    req.params.sessionId = req.session.sessionId;
    req.params.username = username;
    
    next();
  },
  crossOriginHandler: function( req, res, next ) {
    res.header( "Access-Control-Allow-Origin", "*" );
    next();
  }
};
