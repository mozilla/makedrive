if(process.env.NEW_RELIC_ENABLED) {
  require('newrelic');
}

var EventEmitter = require('events').EventEmitter;
var cluster = require('cluster');
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
function ready() {
  if(process.send) {
    process.send({cmd: 'ready'});
  }

  // Signal (to recluster master if we're a child process,
  // and any event listeners like tests, and console) that
  // server is running
  isReady = true;
  module.exports.emit('ready');

  log.info('Started Server Worker.');
}

function shutdown(err) {
  // Deal with multiple things dying at once
  if(shutdown.inProcess) {
    log.error(err, 'Shutdown already in process, additional error received');
    return;
  }

  shutdown.inProcess = true;

  log.fatal(err, 'Starting shutdown process');

  function kill() {
    if (cluster.worker) {
      cluster.worker.disconnect();
    }
    log.fatal('Killing server process');
    process.exit(1);
  }

  try {
    log.info('Attempting to shut down Socket Server [1/3]...');
    SocketServer.close(function() {
      log.info('Attempting to shut down Web Server [2/3]...');
      WebServer.close(function() {
        log.info('Attempting to shut down Redis Clients [3/3]...');
        RedisClients.close(function() {
          log.info('Finished clean shutdown.');
          kill();
        });
      });
    });
  } catch(err2) {
    log.error(err2, 'Unable to complete clean shutdown process');
    kill();
  }
}

// If any of these three major server components blow up,
// we need to shutdown this process, since things aren't stable.
WebServer.on('error', shutdown);
SocketServer.on('error', shutdown);
RedisClients.on('error', shutdown);

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

      ready();
    });
  });
});

module.exports.app = WebServer.app;
Object.defineProperty(module.exports, 'ready', {
  get: function() {
    return isReady;
  }
});
