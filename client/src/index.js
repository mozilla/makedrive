/**
 * MakeDrive is a single/shared Filer filesystem instance with
 * manual- and auto-sync'ing features. A client first gets the
 * filesystem instance like so:
 *
 * var fs = MakeDrive.fs();
 *
 * Multiple calls to MakeDrive.fs() will return the same instance.
 *
 * A number of configuration options can be passed to the fs() function.
 * These include:
 *
 * - manual=true - by default the filesystem syncs automatically in
 * the background. This disables it.
 *
 * - memory=<Boolean> - by default we use a persistent store (indexeddb
 * or websql). Using memory=true overrides and uses a temporary ram disk.
 *
 * - provider=<Object> - a Filer data provider to use instead of the
 * default provider normally used. The provider given should already
 * be instantiated (i.e., don't pass a constructor function).
 *
 * - forceCreate=<Boolean> - by default we return the same fs instance with
 * every call to MakeDrive.fs(). In some cases it is necessary to have
 * multiple instances.  Using forceCreate=true does this.
 *
 * - interval=<Number> - by default, the filesystem syncs every minute if
 * auto syncing is turned on otherwise the interval between syncs can be
 * specified in ms.
 *
 * Various bits of Filer are available on MakeDrive, including:
 *
 * - MakeDrive.Buffer
 * - MakeDrive.Path
 * - MakeDrive.Errors
 *
 * The filesystem instance returned by MakeDrive.fs() also includes
 * a new property `sync`.  The fs.sync property is an EventEmitter
 * which emits the following events:
 *
 * - 'error': an error occured while connecting/syncing. The error
 * object is passed as the first arg to the event.
 *
 * - 'connecting': a connection is being established with the MakeDrive server
 *
 * - 'connected': a connection was established with the MakeDrive server
 *
 * - 'reconnecting': the original connection with the MakeDrive server has failed,
 * and the client is attempting a reconnection.
 *
 * - 'reconnected': a connection was re-established with the MakeDrive server
 *
 * - 'disconnected': the connection to the MakeDrive server was lost, either
 * due to the client or server.
 *
 * - 'syncing': a sync with the server has begun. A subsequent 'completed'
 * or 'error' event should follow at some point, indicating whether
 * or not the sync was successful.
 *
 * - 'completed': a sync has completed and was successful.
 *
 *
 * The `sync` property also exposes a number of methods, including:
 *
 * - connect(url, [options]): try to connect to the specified MakeDrive server URL.
 * An 'error' or 'connected' event will follow, depending on success. The 'options'
 * object can contain 5 options:
 *
 *   -  [autoReconnect] | Whether to reconnect automatically or not on being disconnected (defaults to true)
 *   -  [reconnectAttempts] | How many times to try reconnecting until giving up (defaults to Infinity)
 *   -  [reconnectDelay] | How long to wait (ms) until trying to automatically reconnect (defaults to 1000)
 *   -  [reconnectDelayMax] | How much time to wait between reconnect attempts. Each attempt increases the delay by reconnectDelay (defaults to 5000)
 *   -  [token] | A security token for opening a websocket with the MakeDrive server. If not provided, the client
 *         will automatically attempt to obtain one from the server's /api/sync route. This
 *         requires the user to be authenticated previously with Webmaker.
 *   E.g.
 *    sync.connect('ws://some.url.com', {
 *      autoReconnect: true,
 *      reconnectAttempts: 15,
 *      reconnectDelay: 2000,
 *      reconnectDelayMax: 3000
 *    });
 *
 * - disconnect(): disconnect from the MakeDrive server.
 *
 * - request(path): request a sync with the server for the specified
 * path. Such requests may or may not be processed right away.
 *
 *
 * Finally, the `sync` propery also exposes a `state`, which is the
 * current sync state and can be one of:
 *
 * sync.SYNC_DISCONNECTED = 0 (also the initial state)
 * sync.SYNC_CONNECTING = 1
 * sync.SYNC_CONNECTED = 2
 * sync.SYNC_SYNCING = 3
 * sync.SYNC_ERROR = 4
 */

var SyncManager = require('./sync-manager.js');
var SyncFileSystem = require('./sync-filesystem.js');
var Filer = require('../../lib/filer.js');
var resolvePath = require('../../lib/sync-path-resolver').resolve;
var EventEmitter = require('events').EventEmitter;
var request = require('request');

var MakeDrive = {};
module.exports = MakeDrive;

function createFS(options) {
  options.manual = options.manual === true;
  options.memory = options.memory === true;

  // Use a supplied provider, in memory RAM disk, or Fallback provider (default).
  var provider;
  if(options.provider) {
    provider = options.provider;
  } else if(options.memory) {
    provider = new Filer.FileSystem.providers.Memory('makedrive');
  } else {
    provider = new Filer.FileSystem.providers.Fallback('makedrive');
  }

  // Our fs instance is a modified Filer fs, with extra sync awareness
  // for conflict mediation, etc.  We keep an internal reference to the
  // raw Filer fs, and use the SyncFileSystem instance externally.
  var _fs = new Filer.FileSystem({provider: provider});
  var fs = new SyncFileSystem(_fs);
  var sync = fs.sync = new EventEmitter();
  var manager;

  // Auto-sync handles
  var autoSync;
  var pathCache;

  // State of the sync connection
  sync.SYNC_DISCONNECTED = 0;
  sync.SYNC_CONNECTING = 1;
  sync.SYNC_CONNECTED = 2;
  sync.SYNC_SYNCING = 3;
  sync.SYNC_ERROR = 4;

  // Intitially we are not connected
  sync.state = sync.SYNC_DISCONNECTED;

  // Turn on auto-syncing if its not already on
  sync.auto = function(interval) {
    var syncInterval = interval|0 > 0 ? interval|0 : 60 * 1000;

    if(autoSync) {
      clearInterval(autoSync);
    }

    autoSync = setInterval(sync.request, syncInterval);
  };

  // Turn off auto-syncing and turn on manual syncing
  sync.manual = function() {
    if(autoSync) {
      clearInterval(autoSync);
      autoSync = null;
    }
  };

  sync.onError = function(err) {
    // Regress to the path that needed to be synced but failed
    // (likely because of a sync LOCK)
    fs.pathToSync = pathCache;
    sync.state = sync.SYNC_ERROR;
    sync.emit('error', err);
  };

  sync.onDisconnected = function() {
    sync.state = sync.SYNC_DISCONNECTED;
    sync.emit('disconnected');
  };

  // Request that a sync begin.
  sync.request = function() {
    // If we're not connected (or are already syncing), ignore this request
    if(sync.state === sync.SYNC_DISCONNECTED || sync.state === sync.SYNC_ERROR) {
      sync.emit('error', new Error('Invalid state. Expected ' + sync.SYNC_CONNECTED + ', got ' + sync.state));
      return;
    }

    // If there were no changes to the filesystem, ignore this request
    if(!fs.pathToSync) {
      return;
    }

    // Cache the path that needs to be synced for error recovery
    pathCache = fs.pathToSync;
    fs.pathToSync = null;
    manager.syncPath(pathCache);
  };

  // Try to connect to the server.
  sync.connect = function(url, options) {
    options = options || {};

    options.autoReconnect = option.autoReconnect !== false;
    options.reconnectAttempts = option.reconnectAttempts || Infinity;
    options.reconnectDelay = option.reconnectDelay || 1000;
    options.reconnectDelayMax = option.reconnectDelayMax || 5000;

    // Expose setters/getters to allow the client to change
    // these values later
    Object.defineProperties(sync, {
      "autoReconnect": {
        get: function() { return options.autoReconnect; },
        set: function(newValue) { options.autoReconnect = newValue; }
      },
      "reconnectAttempts": {
        get: function() { return options.reconnectAttempts; },
        set: function(newValue) { options.reconnectAttempts = newValue; }
      },
      "reconnectDelay": {
        get: function() { return options.reconnectDelay; },
        set: function(newValue) { options.reconnectDelay = newValue; }
      },
      "reconnectDelayMax": {
        get: function() { return options.reconnectDelayMax; },
        set: function(newValue) { options.reconnectDelayMax = newValue; }
      }
    });

    // Bail if we're already connected
    if(sync.state !== sync.SYNC_DISCONNECTED &&
       sync.state !== sync.ERROR) {
      sync.emit('error', new Error("MakeDrive: Attempted to connect to \"" + url + "\", but a connection already exists!"));
      return;
    }

    // Also bail if we already have a SyncManager
    if(manager) {
      return;
    }

    // Upgrade connection state to `connecting`
    sync.state = sync.SYNC_CONNECTING;

    function downstreamSyncCompleted() {
      // Re-wire message handler functions for regular syncing
      // now that initial downstream sync is completed.
      sync.onSyncing = function() {
        sync.state = sync.SYNC_SYNCING;
        sync.emit('syncing');
      };

      sync.onCompleted = function(paths) {
        // If changes happened to the files that needed to be synced
        // during the sync itself, they will be overwritten
        // https://github.com/mozilla/makedrive/issues/129 and
        // https://github.com/mozilla/makedrive/issues/3

        function complete() {
          sync.state = sync.SYNC_CONNECTED;
          sync.emit('completed');
        }

        if(!paths) {
          return complete();
        }

        manager.resetUnsynced(paths, function(err) {
          if(err) {
            return sync.onError(err);
          }

          complete();
        });
      };

      // Upgrade connection state to 'connected'
      sync.state = sync.SYNC_CONNECTED;

      // If we're in manual mode, bail before starting auto-sync
      if(options.manual) {
        sync.manual();
      } else {
        sync.auto(options.interval);
      }

      sync.emit('connected');
    }

    function connect(token) {
      // Try to connect to provided server URL. Use the raw Filer fs
      // instance for all rsync operations on the filesystem, so that we
      // can untangle changes done by user vs. sync code.
      manager = new SyncManager(sync, _fs);
      manager.init(url, token, function(err) {
        if(err) {
          sync.onError(err);
          return;
        }

        // In a browser, try to clean-up after ourselves when window goes away
        if("onbeforeunload" in global) {
          sync.cleanupFn = function() {
            if(manager) {
              manager.close();
              manager = null;
            }
          };
          global.addEventListener('beforeunload', sync.cleanupFn);
        }

        // Wait on initial downstream sync events to complete
        sync.onSyncing = function() {
          // do nothing, wait for onCompleted()
        };
        sync.onCompleted = function() {
          // Downstream sync is done, finish connect() setup
          downstreamSyncCompleted();
        };
      });
    }

    function getTokenAndConnect() {
      // Remove WebSocket protocol from URL, and swap for http:// or https://
      // ws://drive.webmaker.org/ -> http://drive.webmaker.org/api/sync
      var apiSync = url.replace(/^([^\/]*\/\/)?/, function(match, p1) {
        return p1 === 'wss://' ? 'https://' : 'http://';
      });
      // Also add /api/sync to the end:
      apiSync = apiSync.replace(/\/?$/, '/api/sync');

      request({
        url: apiSync,
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
        } else {
          connect(body);
        }
      });
    }

    // If we were provided a token, we can connect right away, otherwise
    // we need to get one first via the /api/sync route
    if(token) {
      connect(token);
    } else {
      // Remove WebSocket protocol from URL, and swap for http:// or https://
      // ws://drive.webmaker.org/ -> http://drive.webmaker.org/api/sync
      var apiSync = url.replace(/^([^\/]*\/\/)?/, function(match, p1) {
        return p1 === 'wss://' ? 'https://' : 'http://';
      });
      // Also add /api/sync to the end:
      apiSync = apiSync.replace(/\/?$/, '/api/sync');

      request({
        url: apiSync,
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
        } else {
          connect(body);
        }
      });
    }

    sync.on('disconnected', function() {
      if (options.autoReconnect) {

      }
    });
  };

  // Disconnect from the server
  sync.disconnect = function() {
    // Remove our browser cleanup
    if("onbeforeunload" in global && sync.cleanupFn) {
      global.removeEventListener('beforeunload', sync.cleanupFn);
      sync.cleanupFn = null;
    }

    // Bail if we're not already connected
    if(sync.state === sync.SYNC_DISCONNECTED ||
       sync.state === sync.ERROR) {
      sync.emit('error', new Error("MakeDrive: Attempted to disconnect, but no server connection exists!"));
      return;
    }

    // Do a proper shutdown
    if(manager) {
      manager.close();
      manager = null;
    }

    // Stop auto-syncing
    if(autoSync) {
      clearInterval(autoSync);
      autoSync = null;
      fs.pathToSync = null;
    }

    sync.onDisconnected();
  };

  return fs;
}

// Manage single instance of a Filer filesystem with auto-sync'ing
var sharedFS;

MakeDrive.fs = function(options) {
  options = options || {};

  // We usually only want to hand out a single, shared instance
  // for every call, but sometimes you need multiple (e.g., tests)
  if(options.forceCreate) {
    return createFS(options);
  }

  if(!sharedFS) {
    sharedFS = createFS(options);
  }
  return sharedFS;
};

// Expose bits of Filer that clients will need on MakeDrive
MakeDrive.Buffer = Filer.Buffer;
MakeDrive.Path = Filer.Path;
MakeDrive.Errors = Filer.Errors;
