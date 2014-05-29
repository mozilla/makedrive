// XXXhumph: NOTE that the code below is basically pseudo-code atm.
// We have to figure out how to deal with binary vs. json data,
// file uploads, etc.

module.exports = function( knoxClient ) {

  var version = require( "../package" ).version;

  function jsonError( res, code, msg, err ) {
    res.json( code, {
      msg: msg,
      err: err
    });
  }

  return {

    get: function( req, res ) {
      // TODO: figure out proper errors to bubble up, see:
      // http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
      knoxClient.get( req.params.key )
        .on( "error",  done )
        .on( "response", function( response ) {
          // TODO: figure out right way to return the data (json vs. binary)
          var data = '';
          response.on( "data", function( chunk ) {
            data += chunk;
          }).on( "end", function() {
            res.json( data );
          }).on('error', function( err ) {
            jsonError( res, 400, "Unable to get value.", err );
          });
        })
        .end();
    },

    put: function( req, res ) {
      // TODO: deal with binary data, file parts, ???
      // TODO: figure out proper errors to bubble up, see:
      // http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
      var data = req.body.value,
          headers = {
            'x-amz-acl': 'public-read', // TODO: not sure if we need this...
            'Content-Length': Buffer.byteLength( data,'utf8' ),
            'Content-Type': 'text/plain;charset=UTF-8'
          };

      knoxClient.put( req.params.key, headers )
        .on( "error", function( err ) {
          jsonError( res, 500, "Error storing value", err );
        })
        .on( "response", function(res) {
          if (res.statusCode !== 200) {
            return jsonError( res, 500, "Error storing value", err );
          }
          res.json( 200 );
        })
        .end( data );
    },

    del: function( req, res ) {
      // TODO: figure out proper errors to bubble up, see:
      // http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
      knoxClient.del( req.params.key )
        .on( "error", function( err ) {
          jsonError( res, 500, "Error removing key/value pair", err );
        })
        .on( "response", function(res) {
          if (res.statusCode !== 200) {
            return jsonError( res, 500, "Error removing key/value pair", err );
          }
          res.json( 200 );
        })
        .end();
    },

    healthcheck: function( req, res ) {
      res.json({
        http: "okay",
        version: version
      });
    }

    // TODO: do we want clear?

  };
};
