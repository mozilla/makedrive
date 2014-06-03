module.exports = {
  errorHandler: function( err, req, res, next ) {
    if ( typeof err === "string" ) {
      console.error( "String passed to next(), expected an Error object, got: %s", err );
    }

    var error = {
      message: err.message,
      status: err.status ? err.status : 500
    };

    throw("Error on " + req.path + ": " + err.message);
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
