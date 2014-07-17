var SyncMessage = require( '../../lib/syncmessage' ),
    messageHandler = require('./message-handler'),
    states = require('./sync-states'),
    steps = require('./sync-steps'),
    WebSocket = require('ws');

function SyncManager(sync, fs) {
  var manager = this;

  manager.sync = sync;
  manager.fs = fs;
  manager.session = {
    state: states.CLOSED,
    step: steps.SYNCED,
    path: '/',

    is: Object.create(Object.prototype, {
      // States
      syncing: {
        get: function() { return manager.session.state === states.SYNCING; }
      },
      ready: {
        get: function() { return manager.session.state === states.READY; }
      },
      error: {
        get: function() { return manager.session.state === states.ERROR; }
      },
      closed: {
        get: function() { return manager.session.state === states.CLOSED; }
      },

      // Steps
      init: {
        get: function() { return manager.session.step === steps.INIT; }
      },
      chksum: {
        get: function() { return manager.session.step === steps.CHKSUM; }
      },
      diffs: {
        get: function() { return manager.session.step === steps.DIFFS; }
      },
      patch: {
        get: function() { return manager.session.step === steps.PATCH; }
      },
      synced: {
        get: function() { return manager.session.step === steps.SYNCED; }
      },
      failed: {
        get: function() { return manager.session.step === steps.FAILED; }
      }
    })
  };
}

SyncManager.prototype.init = function(url, token, callback) {
  var manager = this;
  var session = manager.session;
  var sync = manager.sync;

  function handleAuth(event) {
    var data = event.data || event;

    try {
      data = JSON.parse(data);
      data = SyncMessage.parse(data);
    } catch(e) {
      return callback(e);
    }

    if(data.is.response && data.is.authz) {
      session.state = states.READY;
      session.step = steps.SYNCED;

      socket.onmessage = function(event) {
        var data = event.data || event;
        messageHandler(manager, data);
      };

      callback();
    } else {
      callback(new Error('Cannot handle message'));
    }
  }

  function handleClose(info) {
    var reason = info.reason || 'WebSocket closed unexpectedly';
    var error = new Error(info.code + ': ' + reason);

    manager.close();
    manager.socket = null;

    sync.onError(error);
    sync.onDisconnected();
  }

  var socket = manager.socket = new WebSocket(url);
  socket.onmessage = handleAuth;
  socket.onclose = handleClose;
  socket.onopen = function() {
    socket.send(JSON.stringify({token: token}));
  };
};

SyncManager.prototype.syncPath = function(path) {
  var manager = this;

  if(!manager.socket) {
    throw new Error('sync called before init');
  }

  manager.session.path = path;
  manager.socket.send(SyncMessage.request.sync.stringify());
};

SyncManager.prototype.close = function() {
  var manager = this;
  var socket = manager.socket;

  if(socket) {
    socket.onmessage = function(){};
    socket.onopen = function(){};

    if(socket.readyState === 1) {
      socket.onclose = function(){
        manager.socket = null;
      };
      socket.close();
    } else {
      manager.socket = null;
    }
  }
};

module.exports = SyncManager;
