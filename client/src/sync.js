var SyncMessage = require( '../../lib/syncmessage' ),
    messageHandler = require('./message-handler'),
    socket,
    _sync,
    _fs,
    syncCallback,
    states = require('./sync-states'),
    steps = require('./sync-steps'),
    WebSocket = require('ws');

var syncSession = {
  state: states.CLOSED,
  step: steps.SYNCED,
  path: '/',
  is: Object.create(Object.prototype, {
    // States
    syncing: {
      get: function() { return syncSession.state === states.SYNCING; }
    },
    ready: {
      get: function() { return syncSession.state === states.READY; }
    },
    error: {
      get: function() { return syncSession.state === states.ERROR; }
    },
    closed: {
      get: function() { return syncSession.state === states.CLOSED; }
    },

    // Steps
    init: {
      get: function() { return syncSession.step === steps.INIT; }
    },
    chksum: {
      get: function() { return syncSession.step === steps.CHKSUM; }
    },
    diffs: {
      get: function() { return syncSession.step === steps.DIFFS; }
    },
    patch: {
      get: function() { return syncSession.step === steps.PATCH; }
    },
    synced: {
      get: function() { return syncSession.step === steps.SYNCED; }
    },
    failed: {
      get: function() { return syncSession.step === steps.FAILED; }
    }
  })
};

function init(url, token, sync, fs, callback) {
  _sync = sync;
  _fs = fs;
  socket = new WebSocket(url);

  function handleAuth(data, flags) {
    data = data.data;
    try {
      data = JSON.parse(data);
      data = SyncMessage.parse(data);
    } catch(e) {
      return callback(e);
    }

    if(data.is.response && data.is.authz) {
      socket.removeListener('message', handleAuth);
      syncSession.state = states.READY;
      syncSession.step = steps.SYNCED;
      socket.onmessage = function(data, flags) {
        messageHandler(_fs, _sync, syncSession, socket, data, flags, syncCallback);
      };
      return callback();
    }
    callback(new Error('Cannot handle message'));
  }

  function handleClose(code, data) {
    if(data) {
      try {
        data = JSON.parse(data);
      } catch(e) {
        sync.emit('error', e);
        sync.state = sync.SYNC_DISCONNECTED;
        return sync.emit('disconnected');
      }
    } else {
      data = 'Websocket unexpectedly closed.';
    }

    socket.close();
    var error = new Error(code + ': ' + data);
    sync.emit('error', error);
    sync.state = sync.SYNC_DISCONNECTED;
    return sync.emit('disconnected');
  }

  socket.onmessage = handleAuth;
  socket.onclose = handleClose;
  socket.onopen = function() {
    socket.send(JSON.stringify({token: token}));
  };
}

function sync(path, callback) {
  syncSession.path = path;
  syncCallback = callback;

  socket.send(SyncMessage.request.sync.stringify());
}

module.exports = {
  init: init,
  sync: sync
};
