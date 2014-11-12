/**
 * Client info keyed on client id. Mainly used for logging.
 * Getting full details about a client is a multi-part process
 * since we get partial info when they request a token, and more
 * when they finally connect/authenticate over the web socket.
 */
var useragent = require('useragent');
var log = require('./logger.js');

function ClientInfo(id, userAgentString) {
  this.id = id;

  // User isn't yet known, we'll update this in update() later
  this.username = 'unauthenticated';

  // Try to extract useful browser/device info
  try {
    var agent = useragent.parse(userAgentString);
    this.agent = agent.toString();
    this.device = agent.device.toString();
  } catch(err) {
    log.error({err: err}, 'Error parsing user agent string: `%s`', userAgentString);
    this.agent = "Unknown";
    this.device = "Unknown";
  }

  this.born = Date.now();

  // How many times this client has sync'ed during this connection.
  this.downstreamSyncs = 0;
  this.upstreamSyncs = 0;

  // Web Socket data usage for this client
  this.bytesSent = 0;
  this.bytesRecevied = 0;
}

// How long this client has been connected in MS
ClientInfo.prototype.connectedInMS = function() {
  return Date.now() - this.born;
};

/**
 * Keep track of client info objects while they are still connected.
 */
var clients = {};

function remove(id) {
  delete clients[id];
}

function find(client) {
  return clients[client.id];
}

/**
 * Step 1: create a partial ClientInfo object when the client requests a token
 */
function init(id, userAgentString) {
  clients[id] = new ClientInfo(id, userAgentString);
}

/**
 * Step 2: update the ClientInfo object with all the client info when
 * web socket connection is completed.
 */
function update(client) {
  var id = client.id;

  // Auto-remove when this client is closed.
  client.once('closed', function() {
    remove(id);
  });

  var info = find(client);
  if(!info) {
    log.warn('No ClientInfo object found for client.id=%s', id);
    return;
  }
  info.username = client.username;
}

module.exports = {
  init: init,
  update: update,
  remove: remove,
  find: find
};
