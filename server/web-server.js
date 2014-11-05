/**
 * Express web server
 */
var EventEmitter = require('events').EventEmitter;
var domain = require('domain');

var express = require('express');
var helmet = require('helmet');
var Path = require('path');
var http = require('http');
var auth = require('./authentication/index.js');

var env = require('./lib/environment');
var middleware = require('./middleware');
var routes = require('./routes');
var log = require('./lib/logger.js');
var nunjucks = require('nunjucks');
var enableDestroy = require('server-destroy');

var app = express();

var port = process.env.PORT || env.get('PORT') || 9090;
var server;

nunjucks.configure('views', {
  autoescape: true,
  express: app
});

app.use(log.middleware());
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

auth.init(app);

app.use(app.router);

app.use(middleware.errorHandler);
app.use(middleware.fourOhFourHandler);

// Declare routes
routes(app, auth.handler);

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
      log.error('Error starting web server', err);
      return callback(err);
    }
    log.info('Started web server on port %s', port);
    enableDestroy(server);
    callback(null, server);
  });
};
module.exports.close = function(callback) {
  if(!server) {
    return callback();
  }

  server.destroy(function() {
    server = null;
    callback.apply(null, arguments);
  });
};
