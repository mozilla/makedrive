if ( process.env.NEW_RELIC_ENABLED ) {
  require( "newrelic" );
}

var express = require( "express" ),
    helmet = require( "helmet" ),
    Path = require( "path" ),
    http = require( "http" ),
    messina;

// Expose internals
var env = require( "./lib/environment" ),
    middleware = require( "./middleware" ),
    routes = require( "./routes" ),
    socketServer = require( "./lib/socket-server" );

var app = express(),
    distDir = Path.resolve( __dirname, "dist" ),
    logger,
    port;

// Logging middleware
if ( env.get( "ENABLE_GELF_LOGS" ) ) {
  messina = require( "messina" );
  logger = messina( "MakeDrive-" + env.get( "NODE_ENV" ) || "development" );
  logger.init();
  app.use( logger.middleware() );
} else {
  app.use( express.logger( "dev" ) );
}

// General middleware
app.disable( "x-powered-by" );
app.use( helmet.contentTypeOptions() );
app.use( helmet.hsts() );
app.enable( "trust proxy" );
app.use( express.compress() );
app.use(express.static(Path.join(__dirname,'../client')));
app.use( express.json() );
app.use( express.urlencoded() );
app.use( express.cookieParser() );
app.use( express.cookieSession( {
  key: env.get('COOKIE_KEY'),
  secret: env.get('SESSION_SECRET'),
  domain: env.get('COOKIE_DOMAIN'),
  cookie: {
    maxAge: 31536000000,
    secure: env.get('FORCE_SSL')
  },
  proxy: true
}) );

app.use( app.router );

app.use( middleware.errorHandler );
app.use( middleware.fourOhFourHandler );

function corsOptions ( req, res ) {
  res.header( "Access-Control-Allow-Origin", "*" );
}

// Declare routes
routes( app );

port = process.env.PORT || env.get( "PORT", 9090 );
var server = http.createServer( app );
server.listen(port);

socketServer( server );

module.exports = app;
