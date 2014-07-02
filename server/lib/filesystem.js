var Filer = require( "filer" ),
    env = require( "./environment" ),
    providerType = env.get( "FILER_PROVIDER" ) || "filer-fs" ,
    Provider = require( providerType );

var defaults = {};

// TODO: When do we invalidate cache to prevent memory leaks?
var cachedFS = {};

if ( providerType === "filer-s3" ) {
  defaults.bucket = env.get( "S3_BUCKET" );
  defaults.key = env.get( "S3_KEY" );
  defaults.secret = env.get( "S3_SECRET ");
}

module.exports = {
  create: function( options ) {
    Object.keys( defaults ).forEach(function( defaultOption ) {
      options[ defaultOption ] = options[ defaultOption ] || defaults[ defaultOption ];
    });

    // Reuse filesystems whenever possible
    if (!cachedFS[options.keyPrefix]) {
      cachedFS[options.keyPrefix] = new Filer.FileSystem({
        provider: new Provider(options)
      });
    }
    return cachedFS[options.keyPrefix];
  }
};
