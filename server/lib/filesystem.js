var Filer = require( "../../lib/filer.js" ),
    env = require( "./environment" ),
    providerType = env.get( "FILER_PROVIDER" ) || "filer-fs" ,
    Provider = require( providerType );

var defaults = {};

// TODO: Invalidate FS instance cache to prevent memory leaks
//       https://github.com/mozilla/makedrive/issues/16
var cachedFS = {};

if ( providerType === "filer-s3" ) {
  defaults.bucket = env.get( "S3_BUCKET" );
  defaults.key = env.get( "S3_KEY" );
  defaults.secret = env.get( "S3_SECRET");
}

module.exports = {
  clearCache: function( name ) {
    delete cachedFS[name];
  },
  create: function( options ) {
    Object.keys( defaults ).forEach(function( defaultOption ) {
      options[ defaultOption ] = options[ defaultOption ] || defaults[ defaultOption ];
    });

    // Reuse filesystems whenever possible
    if (!cachedFS[options.name]) {
      cachedFS[options.name] = new Filer.FileSystem({
        provider: new Provider(options)
      });
    }
    return cachedFS[options.name];
  }
};
