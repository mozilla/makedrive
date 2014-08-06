var Sync = require('./lib/sync');
var env = require('./lib/environment');
var websocketAuth = require('./lib/websocket-auth');

function generateError( code, msg ) {
  var err = new Error( msg );
  err.status = code;
  return err;
}

module.exports = {
  authenticationHandler: function( req, res, next ) {
    var username = req.session && req.session.user && req.session.user.username;

    // If cookie session doesn't exist, check to see if data got passed in via query string
    if ( !username && !!env.get( "ALLOW_QUERY_STRING_API_SYNC" ) && req.query.username ) {
      username = req.query.username;
    }

    if( !username ) {
      return next( generateError( 401, "Webmaker Authentication Required." ) );
    }

    req.params.username = username;

    next();
  },

  crossOriginHandler: function( req, res, next ) {
    if (env.get("ALLOWED_CORS_DOMAINS").indexOf(req.headers.origin) > -1) {
      res.header('Access-Control-Allow-Origin', req.headers.origin);
      res.header('Access-Control-Allow-Credentials', true);
    }

    next();
  },

  errorHandler: function( err, req, res, next ) {
    if ( typeof err === "string" ) {
      console.error( "String passed to next(), expected an Error object, got: %s", err );
    }

    var error = {
      message: err.message,
      status: err.status ? err.status : 500
    };

    res.status( error.status ).json( error );
  },

  fourOhFourHandler: function( req, res, next ) {
    var error = {
      message: "You found a loose thread!",
      status: 404
    };

    res.status( error.status ).json( error );
  }
};
