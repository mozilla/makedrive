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
} else if ( providerType === "filer-sql" ) {
  defaults.type = Provider[env.get( "DB_TYPE" )];
  defaults.db = {
    name: env.get( "DB_NAME" ),
    username: env.get( "DB_USERNAME" ),
    password: env.get( "DB_PASSWORD" )
  };
}

module.exports = {
  clearCache: function( name ) {
    delete cachedFS[name];
  },
  create: function( options ) {
    // in filer-sql we are expecting option 'user' which is the same as 'options.name'
    defaults.user = providerType === "filer-sql" ? options.name : "";
    Object.keys( defaults ).forEach(function( defaultOption ) {
      options[ defaultOption ] = options[ defaultOption ] || defaults[ defaultOption ];
    });

    // Reuse filesystems whenever possible
    if (!cachedFS[options.name]) {
      cachedFS[options.name] = new Filer.FileSystem({
        provider: new Provider(options)
      }, function(err) {
        if(err) {
          console.error('MakeDrive Filesystem Initialization Error: ', err);
        }
      });
    }
    return cachedFS[options.name];
  }
};
