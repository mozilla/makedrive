var SyncMessage = require( '../../lib/syncmessage' ),
    messageHandler = require('./message-handler'),
    states = require('./sync-states'),
    steps = require('./sync-steps'),
    WebSocket = require('ws'),
    fsUtils = require('../../lib/fs-utils'),
    async = require('../../lib/async-lite.js');
    var request = require('request');

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

SyncManager.prototype.init = function(url, token, options, callback) {
  var manager = this;
  var session = manager.session;
  var sync = manager.sync;
  var reconnectCounter = 0;
  var socket;
  var timeout;

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
      manager.send(SyncMessage.response.authz.stringify());

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

  // Reconnecting WebSocket options
  var reconnectAttempts;
  var reconnectionDelay;
  var reconnectionDelayMax;

  if(options.autoReconnect) {
    reconnectAttempts = options.reconnectAttempts ? options.reconnectAttempts : Math.Infinity;
    reconnectionDelay = options.reconnectionDelay ? options.reconnectionDelay : 1000;
    reconnectionDelayMax = options.reconnectionDelayMax ? options.reconnectionDelayMax : 5000;
  }

  function getToken(callback) {
    var apiSyncURL;
    try {
      apiSyncURL = new URL(url);
    } catch(err) {
      sync.onError(err);
    }
    apiSyncURL.protocol = apiSyncURL.protocol === 'wss://' ? 'https://' : 'http://';
    apiSyncURL.pathname = "api/sync"
    apiSyncURL = apiSyncURL.toString();

    request({
      url: apiSyncURL,
      method: 'GET',
      json: true,
      withCredentials: true
    }, function(err, msg, body) {
      var statusCode;
      var error;

      statusCode = msg && msg.statusCode;
      error = statusCode !== 200 ?
        { message: err || 'Unable to get token', code: statusCode } : null;

      if(error) {
        sync.onError(error);
      } else{
        callback(body);
      }
    });
  }

  function connect(reconnecting) {
    clearTimeout(timeout);
    socket = new WebSocket(url);
    socket.onmessage = handleAuth;
    socket.onopen = function() {
      manager.socket = socket;
      reconnectCounter = 0;
      // We checking for `reconnecting` to see if this is their first time connecting to
      // WebSocket and have provided us with a valid token. Otherwise this is a reconnecting
      // to WebSocket and we will retrieve a new valid token.
      if(!reconnecting && token) {
        manager.send(JSON.stringify({token: token}));
      } else {
        getToken(function(token) {
          manager.send(JSON.stringify({token: token}));
        });
      }
    };
    if(options.autoReconnect) {
      socket.onclose = function() {
        // Clean up after WebSocket closed.
        socket.onclose = function(){};
        socket.close();
        socket = null;
        manager.socket = null;

        // We only want to emit an error once.
        if(reconnectCounter === 0) {
          var error = new Error('WebSocket closed unexpectedly');
          sync.onError(error);
          sync.onDisconnected();
        }

        if(reconnectAttempts < reconnectCounter) {
          sync.emit('reconnect_failed');
        } else {
          var delay = reconnectCounter * reconnectionDelay;
          delay = Math.min(delay, reconnectionDelayMax);
          timeout = setTimeout(function () {
            reconnectCounter++;
            sync.emit('reconnecting');
            connect(true);
          }, delay);
        }
      };
    } else {
      socket.onclose = handleClose;
    }
  }
  connect();
};

SyncManager.prototype.syncPath = function(path) {
  var manager = this;
  var syncRequest;

  if(!manager.socket) {
    throw new Error('sync called before init');
  }

  syncRequest = SyncMessage.request.sync;
  syncRequest.content = {path: path};
  manager.send(syncRequest.stringify());
};

// Remove the unsynced attribute for a list of paths
SyncManager.prototype.resetUnsynced = function(paths, callback) {
  var fs = this.fs;

  function removeUnsyncedAttr(path, callback) {
    fsUtils.removeUnsynced(fs, path, function(err) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      callback();
    });
  }

  async.eachSeries(paths, removeUnsyncedAttr, function(err) {
    if(err) {
      return callback(err);
    }

    callback();
  });
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

SyncManager.prototype.send = function(syncMessage) {
  var manager = this;
  var ws = manager.socket;

  if(!ws || ws.readyState !== ws.OPEN) {
    sync.onError(new Error('Socket state invalid for sending'));
  }

  try {
    ws.send(syncMessage);
  } catch(err) {
    // This will also emit an error.
    sync.onError(err);
    ws.close();
  }
};

module.exports = SyncManager;
