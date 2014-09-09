/**
 * Express web server
 */
var EventEmitter = require('events').EventEmitter;
var domain = require('domain');

var express = require('express');
var helmet = require('helmet');
var WebmakerAuth = require('webmaker-auth');
var Path = require('path');
var http = require('http');

var env = require('./lib/environment');
var middleware = require('./middleware');
var routes = require('./routes');
var log = require('./lib/logger.js');

var app = express();
var distDir = Path.resolve(__dirname, 'dist');
var webmakerAuth = new WebmakerAuth({
  loginURL: env.get('LOGIN'),
  secretKey: env.get('SESSION_SECRET'),
  forceSSL: env.get('FORCE_SSL'),
  domain: env.get('COOKIE_DOMAIN')
});
var port = process.env.PORT || env.get('PORT') || 9090;
var logger;
var server;

// TODO - figure out how to make this play nicely with lib/logger.js
// https://github.com/mozilla/makedrive/issues/389
//if(env.get('ENABLE_GELF_LOGS')) {
//  logger = require('messina')('MakeDrive-' + (env.get('NODE_ENV') || 'development')));
//  logger.init();
//  app.use(logger.middleware());
//} else {
//  app.use(express.logger('dev'));
//}

// General middleware
app.disable('x-powered-by');
app.use(function(req, res, next) {
  var d = domain.create();
  d.add(req);
  d.add(res);
  d.on('error', function(err) {
    // Bubble this fatal error up to the top-level server
    log.fatal(err, 'Web Server domain error');
    module.exports.emit('error', err);
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

module.exports = new EventEmitter();
module.exports.app = app;
module.exports.start = function(callback) {
  if(server) {
    // Already started
    return callback(null, server);
  }

  server = http.createServer(app);
  server.listen(port, function(err) {
    if(err) {
      return callback(err);
    }
    callback(null, server);
  });
};
module.exports.close = function(callback) {
  if(!server) {
    return callback();
  }

  server.close(callback);
};
