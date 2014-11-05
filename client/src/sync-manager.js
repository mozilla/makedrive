var SyncMessage = require( '../../lib/syncmessage' ),
    messageHandler = require('./message-handler'),
    WS = require('ws'),
    request = require('request'),
    url = require('url'),
    log = require('./logger.js');

function SyncManager(sync, fs, _fs) {
  var manager = this;

  manager.sync = sync;
  manager.fs = fs;
  manager.rawFs = _fs;
  manager.downstreams = [];
  manager.needsUpstream = [];
}

SyncManager.prototype.init = function(wsUrl, token, options, callback) {
  var manager = this;
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
      apiSyncURL = url.parse(wsUrl);
    } catch(err) {
      sync.onError(err);
    }
    apiSyncURL.protocol = apiSyncURL.protocol === 'wss:' ? 'https:' : 'http:';
    apiSyncURL.pathname = "api/sync";
    apiSyncURL = url.format(apiSyncURL);

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
    socket = new WS(wsUrl);
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

SyncManager.prototype.syncUpstream = function() {
  var manager = this;
  var fs = manager.fs;
  var sync = manager.sync;
  var syncRequest;
  var syncInfo;

  if(!manager.socket) {
    throw new Error('sync called before init');
  }

  if(manager.currentSync) {
    sync.onError(new Error('Sync currently underway'));
    return;
  }

  fs.getPathsToSync(function(err, pathsToSync) {
    if(err) {
      sync.onError(err);
      return;
    }

    if(!pathsToSync || !pathsToSync.length) {
      log.warn('Nothing to sync');
      sync.onIdle('No changes made to the filesystem');
      return;
    }

    syncInfo = pathsToSync[0];

    fs.setSyncing(function(err) {
      if(err) {
        sync.onError(err);
        return;
      }

      manager.currentSync = syncInfo;
      syncRequest = SyncMessage.request.sync;
      syncRequest.content = {path: syncInfo.path, type: syncInfo.type};
      if(syncInfo.oldPath) {
        syncRequest.content.oldPath = syncInfo.oldPath;
      }
      manager.send(syncRequest.stringify());
    });
  });
};

SyncManager.prototype.syncNext = function(syncedPath) {
  var manager = this;
  var fs = manager.fs;
  var sync = manager.sync;

  fs.dequeueSync(function(err, syncsLeft, dequeuedSync) {
    if(err) {
      log.error('Failed to dequeue sync for ' + syncedPath + ' in SyncManager.syncNext()');
    }

    sync.onCompleted(dequeuedSync || syncedPath);
    manager.currentSync = false;
    manager.syncUpstream();
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
  var sync = manager.sync;
  var ws = manager.socket;

  if(!ws || ws.readyState !== ws.OPEN) {
    sync.onError(new Error('Socket state invalid for sending'));
  }

  try {
    ws.send(syncMessage);
  } catch(err) {
    // This will also emit an error.
    ws.close();
  }
};

module.exports = SyncManager;
