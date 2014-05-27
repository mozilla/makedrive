var util = require( "./util" );

module.exports = {

  authenticationHandler: function( req, res, next ) {
    var id = util.getUserID( req );
    if ( !id ) {
      return next( util.error( 401, "Webmaker Authentication Required." ) );
    }

    // Prefix key with Webmaker User ID
    req.params.userid = id;
    next();
  },

  crossOriginHandler: function( req, res, next ) {
    res.header( "Access-Control-Allow-Origin", "*" );
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
