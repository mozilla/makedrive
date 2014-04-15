if ( process.env.NEW_RELIC_ENABLED ) {
  require( "newrelic" );
}

var express = require( "express" ),
    helmet = require( "helmet" ),
    WebmakerAuth = require( "webmaker-auth" );

var app = express(),
    env = require( "./environment" ),
    Path = require( "path" ),
    distDir = Path.resolve( __dirname, "dist" ),
    emulateS3 = env.get( "S3_EMULATION" ) || !env.get( "S3_KEY" ),
    webmakerAuth = new WebmakerAuth({
      loginURL: env.get( "LOGIN_SERVER_URL_WITH_AUTH" ),
      secretKey: env.get( "SESSION_SECRET" ),
      forceSSL: env.get( "FORCE_SSL" ),
      domain: env.get( "COOKIE_DOMAIN" )
    }),
    knoxClient = knox.createClient( env.get( "S3" ) ),
    messina,
    logger,
    port;

if ( env.get( "ENABLE_GELF_LOGS" ) ) {
  messina = require( "messina" );
  logger = messina( "MakeDrive-" + env.get( "NODE_ENV" ) || "development" );
  logger.init();
  app.use( logger.middleware() );
} else {
  app.use( express.logger( "dev" ) );
}

app.disable( "x-powered-by" );
app.use( helmet.contentTypeOptions() );
app.use( helmet.hsts() );
app.enable( "trust proxy" );
app.use( express.compress() );
app.use( express.json() );
app.use( express.urlencoded() );
app.use( webmakerAuth.cookieParser() );
app.use( webmakerAuth.cookieSession() );

app.use( app.router );

var routes = require( "./routes" )( knoxClient ),
    middleware = require( "./middleware" );

app.use( middleware.errorHandler );
app.use( middleware.fourOhFourHandler );

function corsOptions ( req, res ) {
  res.header( "Access-Control-Allow-Origin", "*" );
  res.header( "Access-Control-Allow-Headers", "Content-Type" );
  res.send( 200 );
}

app.get( "/", routes.index );

app.get( "api/:key", middleware.authenticationHandler, routes.get );
app.put( "api/:key", middleware.authenticationHandler, routes.put );
app.del( "api/:key", middleware.authenticationHandler, routes.del );

// Serve makedrive client-side js files
app.get( "/js/makedrive.js", function( req, res ) {
  res.sendfile( Path.join( distDir, "makedrive.js" ) );
});
app.get( "/js/makedrive.min.js", function( req, res ) {
  res.sendfile( Path.join( distDir, "makedrive.min.js" ) );
});

app.get( "/healthcheck", routes.healthcheck );

port = env.get( "PORT", 9090 );
app.listen( port, function() {
  console.log( "MakeDrive server listening ( Probably http://localhost:%d )", port );
});

// If we're in running in emulated S3 mode, run a mini
// server for serving up the "s3" published content.
if (emulateS3) {
  require( "mox-server" ).runServer( env.get( "MOX_PORT", 12319 ) );
}
