var EventEmitter = require('events').EventEmitter;
var log = require('./lib/logger.js');
var WebSocketServer = require('ws').Server;
var ClientManager = require('./lib/client-manager.js');
var Client = require('./lib/client.js');
var wss;

module.exports = new EventEmitter();

module.exports.start = function(server, callback) {
  try {
    wss = new WebSocketServer({server: server, clientTracking: false});
  } catch(err) {
    log.error(err, 'Could not start Socket Server');
    return callback(err);
  }

  wss.on('connection', function(ws) {
    log.debug('New web socket client connected');
    var client = new Client(ws);
    ClientManager.add(client);
  });

  wss.on('error', function(err) {
    log.error(err, 'Socket server error');
    module.exports.emit('error', err);
  });

  callback();
};

module.exports.close = function(callback) {
  // Stop taking new client socket connections
  if(wss) {
    try {
      wss.close();
    } catch(e) {
      log.error(e, 'Error shutting down Socket Server:');
    } finally {
      wss = null;
    }
  }

  // Attempt to safely conclude any active syncs, and disconnect clients
  ClientManager.shutdown(callback);
};
