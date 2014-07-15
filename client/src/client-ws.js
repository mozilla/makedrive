/**
 * In node.js we want to use the ws module for WebSocket. In the
 * browser we can just use the native WebSocket. Here we adapt
 * the browser's WebSocket interface to more closely match ws
 * so that we can use either.
 *
 * This module gets used by browserify, see package.json
 */

global.WebSocket.on = global.WebSocket.on || function(event, listener) {
  this.addEventListener(event, listener);
};

global.WebSocket.removeListener = global.WebSocket.removeListener || function(event, listener) {
  this.removeEventListener(event, listener);
};

global.WebSocket.once = global.WebSocket.once || function(event, listener) {
  var ws = this;
  this.addEventListener(event, function onEvent() {
    ws.removeEventListener(event, onEvent);
    listener.apply(null, arguments);
  });
};

module.exports = global.WebSocket;
