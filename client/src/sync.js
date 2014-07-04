var SyncMessage = require( './syncmessage' ),
    messageHandler = require('./message-handler'),
    socket,
    _sync,
    _fs,
    syncCallback,
    states = require('./sync-states'),
    steps = require('./sync-steps');

var syncSession = {
  state: states.CLOSED,
  step: steps.SYNCED,
  path: '/'
};

function init(url, token, sync, fs, callback) {
  _sync = sync;
  _fs = fs;
  socket = new WebSocket(url);
  
  function handleAuth(data, flags) {
    data = data.data;
    try {
      data = JSON.parse(data);
    } catch(e) {
      return callback(e);
    }
    
    if(data.type === SyncMessage.RESPONSE && data.name === SyncMessage.AUTHZ) {
      socket.removeEventListener('message', handleAuth);
      syncSession.state = states.READY;
      syncSession.step = steps.SYNCED;
      socket.onmessage = function(data, flags) {
        messageHandler(_fs, _sync, syncSession, socket, data, flags, callback);
      };
      return callback();
    }
    callback(new Error('Cannot handle message'));
  }

  function handleClose(code, data) {
    try {
      data = JSON.parse(data);
    } catch(e) {
      sync.emit('error', e);
      sync.state = sync.SYNC_DISCONNECTED;
      return sync.emit('disconnected');
    }
    
    socket.close();
    var error = new Error(code + ': ' + data);
    sync.emit('error', error);
    sync.state = sync.SYNC_DISCONNECTED;
    return sync.emit('disconnected');
  }
  
  socket.onmessage = handleAuth;
  socket.onclose = handleClose;
  socket.send(JSON.stringify({token: token}));
}

function sync(path, callback) {
  syncSession.path = path;
  syncCallback = callback;
  var message = new SyncMessage(SyncMessage.REQUEST, SyncMessage.SYNC);
  socket.send(JSON.stringify(message));
}

module.exports = {
  init: init,
  sync: sync
};
