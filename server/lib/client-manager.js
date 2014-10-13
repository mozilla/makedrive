var Client = require('./client.js');
var WebsocketAuth = require('./websocket-auth.js');
var SyncMessage = require('../../lib/syncmessage.js');
var filesystem = require('./filesystem');
var Constants = require('../../lib/constants.js');
var States = Constants.server.states;
var log = require('./logger.js');

/**
 * Handle initial connection and authentication, bind user data
 * to client, including filesystem, and switch the client to normal
 * run mode.
 */
function initClient(client) {
  var ws = client.ws;

  client.state = States.CONNECTING;

  // Wait until we get the user's token so we can finish authorizing
  ws.onmessage = function(msg) {
    var data;
    try {
      data = JSON.parse(msg.data);
    } catch(err) {
      log.error({client: client, err: err}, 'Error parsing client token. Data was `%s`', msg.data);
      client.close({
        code: 1011,
        message: 'Error: token could not be parsed.'
      });
      return;
    }

    // Authorize user
    var token = data.token;
    var username = WebsocketAuth.getAuthorizedUsername(token);
    if (!username) {
      log.warn({client: client}, 'Client sent an invalid or expired token (could not get username): token=%s', token);
      client.close({
        code: 1008,
        message: 'Error: invalid token.'
      });
      return;
    }

    // Update client details now that he/she is authenticated
    client.id = token;
    client.username = username;
    client.fs = filesystem.create({
      keyPrefix: username,
      name: username
    });

    log.info({client: client}, 'Client connected');

    runClient(client);
  };
}

/**
 * Run the client normally through protocol steps.
 */
function runClient(client) {
  var ws = client.ws;

  function invalidMessage() {
    var message = SyncMessage.error.format;
    message.content = {error: 'Unable to parse/handle message, invalid message format.'};
    client.sendMessage(message);
  }

  ws.onmessage = function(msg, flags) {
    var data;
    var message;

    if(!flags || !flags.binary) {
      try {
        data = JSON.parse(msg.data);
        message = SyncMessage.parse(data);

        // Delegate ws messages to the sync protocol handler at this point
        client.handler.handleMessage(message);
      } catch(error) {
        log.error({client: client, err: error}, 'Unable to parse/handle client message. Data was `%s`', msg.data);
        invalidMessage();
      }
    } else {
      log.warn({client: client}, 'Expected string but got binary data over web socket.');
      invalidMessage();
    }
  };

  // Send an AUTHZ response to let client know normal sync'ing can begin.
  client.state = States.INIT;
  client.sendMessage(SyncMessage.response.authz);
  log.debug({client: client}, 'Starting authorized client session');
}

/**
 * Client list managment
 */
var clients = [];

/**
 * Add a client to the list, and manage its life-cycle.
 */
function add(client) {
  // Auto-remove clients on close
  client.once('closed', function() {
    remove(client);
  });

  clients.push(client);
  initClient(client);
}

/**
 * Remove client from the list. Does not affect client state
 * or life-cycle.
 */
function remove(client) {
  var idx = clients.indexOf(client);
  if(idx > -1) {
    clients.splice(idx, 1);
  }
}

/**
 * Safe shutdown, waiting on all clients to close.
 */
function shutdown(callback) {
  var closed = 0;
  var connected = clients.length;
  var client;

  function maybeFinished() {
    if(++closed >= connected) {
      clients = null;
      log.info('[Shutdown] All client connections safely closed.');
      callback();
    }
    log.info('[Shutdown] Closed client %s of %s.', closed, connected);
  }

  if(connected === 0) {
    return maybeFinished();
  }

  clients.forEach(function(client) {
    client.once('closed', maybeFinished);
    client.close();
  });
}

module.exports = {
  add: add,
  remove: remove,
  shutdown: shutdown
};
