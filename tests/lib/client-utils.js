var WebServer = require('../../server/web-server.js');
var WebSocketServer = require('ws').Server;
var env = require('../../server/lib/environment');
var expect = require('chai').expect;
var SyncMessage = require('../../lib/syncmessage.js');

var SocketServer;
var serverURL = 'http://127.0.0.1:' + env.get('PORT');
var socketURL = serverURL.replace( 'http', 'ws' );
var TOKEN = 'TOKEN';

function run(callback) {
  if(SocketServer) {
    return callback(SocketServer);
  }

  WebServer.start(function(err, server) {
    if(err) {
      return callback(err);
    }

    SocketServer = new WebSocketServer({server: server});
    callback(SocketServer);
  });
}

function decodeSocketMessage(message) {
  expect(message).to.exist;

  try {
    message = JSON.parse(message);
  } catch(err) {
    expect(err, 'Could not parse ' + message).not.to.exist;
  }

  return message;
}

function authenticateAndRun(sync, callback) {
  SocketServer.once('connection', function(client) {
    client.once('message', function() {
      client.once('message', function(message) {
        callback(client, message);
      });

      client.send(SyncMessage.response.authz.stringify());
    });
  });

  sync.connect(socketURL, TOKEN);
}

function close(callback) {
  if(!SocketServer) {
    return callback();
  }

  WebServer.close(function() {
    SocketServer.close();
    SocketServer = null;
    callback.apply(null, arguments);
  });
}

module.exports = {
  serverURL: serverURL,
  socketURL: socketURL,
  TOKEN: TOKEN,
  run: run,
  decodeSocketMessage: decodeSocketMessage,
  authenticateAndRun: authenticateAndRun,
  close: close
};
