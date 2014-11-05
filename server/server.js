if(process.env.NEW_RELIC_ENABLED) {
  require('newrelic');
}

var EventEmitter = require('events').EventEmitter;
var log = require('./lib/logger.js');

var WebServer = require('./web-server.js');
var SocketServer = require('./socket-server.js');
var RedisClients = require('./redis-clients.js');

module.exports = new EventEmitter();

/**
 * The server isn't really ready until various bits
 * all get started. Any callers who want to use app
 * should be careful to make sure everything is actually
 * running (e.g., listen for 'ready' and/or check the
 * module's ready property.
 */
var isReady = false;

function shutdown(err) {
  // Deal with multiple things dying at once
  if(shutdown.inProcess) {
    log.error(err, 'Shutdown already in process, additional error received');
    return;
  }

  isReady = false;
  shutdown.inProcess = true;
  log.fatal(err, 'Starting shutdown process');

  try {
    log.info('Attempting to shut down Socket Server [1/3]...');
    SocketServer.close(function() {
      log.info('Attempting to shut down Web Server [2/3]...');
      WebServer.close(function() {
        log.info('Attempting to shut down Redis Clients [3/3]...');
        RedisClients.close(function() {
          log.info('Finished clean shutdown.');
          shutdown.inProcess = false;
          module.exports.emit('shutdown');
        });
      });
    });
  } catch(err2) {
    shutdown.inProcess = false;
    module.exports.emit('shutdown', err2);
  }
}

function shutdownAndLog(source) {
  return function(err) {
    log.fatal('Shutdown initiated by %s', source);
    shutdown(err);
  };
}

// If any of these three major server components blow up,
// we need to shutdown this process, since things aren't stable.
WebServer.on('error', shutdownAndLog('Web Server'));
SocketServer.on('error', shutdownAndLog('WebSocket Server'));
RedisClients.on('error', shutdownAndLog('Redis Clients'));

// We also want to guard against the process blowing up in other ways
// or being killed via user/system intervention.
process.on('SIGINT', shutdownAndLog('SIGINT'));
process.on('error', shutdownAndLog('process.error'));

module.exports.start = function(callback) {
  RedisClients.start(function(err) {
    if(err) {
      log.fatal(err, 'Redis Clients Startup Error');
      return shutdown(err);
    }

    WebServer.start(function(err, server) {
      if(err) {
        log.fatal(err, 'Web Server Startup Error');
        return shutdown(err);
      }

      SocketServer.start(server, function(err) {
        if(err) {
          log.fatal(err, 'Socket Server Startup Error');
          return shutdown(err);
        }

        isReady = true;
        module.exports.emit('ready');

        log.info('Started Server Worker.');
        callback();
      });
    });
  });
};

module.exports.shutdown = function(callback) {
  module.exports.once('shutdown', callback);
  shutdown('Requested shutdown');
};

Object.defineProperty(module.exports, 'app', {
  get: function() {
    return WebServer.app;
  }
});
Object.defineProperty(module.exports, 'ready', {
  get: function() {
    return isReady;
  }
});
