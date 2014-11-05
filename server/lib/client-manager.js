var WebsocketAuth = require('./websocket-auth.js');
var SyncMessage = require('../../lib/syncmessage.js');
var filesystem = require('./filesystem');
var Constants = require('../../lib/constants.js');
var States = Constants.server.states;
var log = require('./logger.js');
var ClientInfo = require('./client-info.js');

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
    var info;

    if(!flags || !flags.binary) {
      try {
        // Keep track of how much data we receive
        info = client.info();
        if(info) {
          info.bytesReceived += Buffer.byteLength(msg.data, 'utf8');
        }

        data = JSON.parse(msg.data);
        message = SyncMessage.parse(data);
      } catch(error) {
        log.error({client: client, err: error}, 'Unable to parse/handle client message. Data was `%s`', msg.data);
        return invalidMessage();
      }

      // Delegate ws messages to the sync protocol handler at this point
      client.handler.handleMessage(message);
    } else {
      log.warn({client: client}, 'Expected string but got binary data over web socket.');
      invalidMessage();
    }
  };

  // Send an AUTHZ response to let client know normal sync'ing can begin.
  client.state = States.LISTENING;
  client.sendMessage(SyncMessage.response.authz);
  log.debug({client: client}, 'Starting authorized client session');
}

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
    var info;

    try {
      // Keep track of how much data we receive
      info = client.info();
      if(info) {
        info.bytesReceived += Buffer.byteLength(msg.data, 'utf8');
      }

      data = JSON.parse(msg.data);
    } catch(err) {
      log.error({client: client, err: err}, 'Error parsing client token. Data was `%s`', msg.data);
      ClientInfo.remove(token);
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
      ClientInfo.remove(token);
      client.close({
        code: 1008,
        message: 'Error: invalid token.'
      });
      return;
    }

    // Update client details now that he/she is authenticated
    client.id = token;
    client.username = username;
    client.fs = filesystem.create(username);
    ClientInfo.update(client);

    log.info({client: client}, 'Client connected');

    runClient(client);
  };
}

/**
 * Client list managment
 */
var clients = [];

/**
 * Remove client from the list. Does not affect client state
 * or life-cycle.
 */
function remove(client) {
  if(!clients) {
    return;
  }

  var idx = clients.indexOf(client);
  if(idx > -1) {
    clients.splice(idx, 1);
  }
}

/**
 * Add a client to the list, and manage its life-cycle.
 */
function add(client) {
  // Auto-remove clients on close
  client.once('closed', function() {
    remove(client);
  });

  clients = clients || [];
  clients.push(client);
  initClient(client);
}

/**
 * Safe shutdown, waiting on all clients to close.
 */
function shutdown(callback) {
  var closed = 0;
  var connected = clients ? clients.length : 0;

  function maybeFinished() {
    if(++closed >= connected) {
      clients = null;
      log.info('[Shutdown] All client connections safely closed.');
      return callback();
    }

    log.info('[Shutdown] Closed client %s of %s.', closed, connected);
  }

  if(!connected) {
    return maybeFinished();
  }

  var client;

  for(var i = 0; i < connected; i++) {
    client = clients[i] || null;

    if(!client) {
      maybeFinished();
    } else {
      client.once('closed', maybeFinished);

      if(client.state !== States.CLOSING && client.state !== States.CLOSED) {
        client.close();
      }
    }
  }
}

module.exports = {
  add: add,
  remove: remove,
  shutdown: shutdown
};
