if(process.env.NEW_RELIC_ENABLED) {
  require('newrelic');
}

var cluster = require('cluster');
var domain = require('domain');
var express = require('express');
var helmet = require('helmet');
var WebmakerAuth = require('webmaker-auth');
var Path = require('path');
var http = require('http');

var env = require('./lib/environment');
var middleware = require('./middleware');
var routes = require('./routes');
var socketServer = require('./lib/socket-server');

var app = express();
var distDir = Path.resolve(__dirname, 'dist');
var webmakerAuth = new WebmakerAuth({
  loginURL: env.get('LOGIN'),
  secretKey: env.get('SESSION_SECRET'),
  forceSSL: env.get('FORCE_SSL'),
  domain: env.get('COOKIE_DOMAIN')
});
var logger;
var server;
var port;

// Logging middleware
if(env.get('ENABLE_GELF_LOGS')) {
  messina = require("messina");
  logger = messina("makedrive-" + env.get("NODE_ENV") || "development");
  logger.init();
  app.use(logger.middleware());
} else {
  app.use(express.logger('dev'));
}

// General middleware
app.disable('x-powered-by');
app.use(function(req, res, next) {
  var d = domain.create();
  d.add(req);
  d.add(res);

  function done() {
    if (cluster.worker) {
      cluster.worker.disconnect();
    }
    res.send(500);
    d.dispose();
    process.exit(1);
  }

  d.once('error', function(err) {
    console.error('Server worker error:', err.stack);
    try {
      // make sure we close down within 30 seconds
      var killtimer = setTimeout(function() {
        process.exit(1);
      }, 30000);
      // But don't keep the process open just for that!
      killtimer.unref();

      if(server) {
        server.close(done);
      } else {
        done();
      }
    } catch(err2) {
      console.error('Server worker shutdown error:', err2.stack);
    }
  });

  d.run(next);
});
app.use(middleware.crossOriginHandler);
app.use(helmet.contentTypeOptions());
app.use(helmet.hsts());
app.enable('trust proxy');
app.use(express.compress());
app.use(express.static(Path.join(__dirname, '../client')));
if(env.get('NODE_ENV') === 'development') {
  app.use('/demo', express.static(Path.join(__dirname, '../demo')));
}
app.use(express.json());
app.use(express.urlencoded());
app.use(webmakerAuth.cookieParser());
app.use(webmakerAuth.cookieSession());

app.use(app.router);

app.use(middleware.errorHandler);
app.use(middleware.fourOhFourHandler);

// Declare routes
routes(app, webmakerAuth);

port = process.env.PORT || env.get('PORT') || 9090;
server = http.createServer(app);
server.listen(port);

socketServer(server);

module.exports = app;
