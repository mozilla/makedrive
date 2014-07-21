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
 * - memory=true - by default we use a persistent store (indexeddb
 * or websql). This overrides and uses a temporary ram disk.
 * - provider=<Object> - a Filer data provider to use instead of the
 * default provider normally used. The provider given should already
 * be instantiated (i.e., don't pass a constructor function).
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
 * - 'connected': a connection was established with the sync server
 *
 * - 'disconnected': the connection to the sync server was lost, either
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
 * - connect(url): try to connet to the specified sync server URL.
 * An 'error' or 'connected' event will follow, depending on success.
 *
 * - disconnect(): disconnect from the sync server.
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
var Filer = require('../../lib/filer.js');
var EventEmitter = require('events').EventEmitter;

var MakeDrive = {};
module.exports = MakeDrive;

// We manage a single fs instance internally. NOTE: that other
// tabs/windows may also be using this same instance (i.e., fs
// is shared at the provider level).
var _fs;

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

  _fs = new Filer.FileSystem({provider: provider});
  var sync = _fs.sync = new EventEmitter();

  // Auto-sync handles
  var watcher;
  var syncInterval;
  var needsSync = false;

  // State of the sync connection
  sync.SYNC_DISCONNECTED = 0;
  sync.SYNC_CONNECTING = 1;
  sync.SYNC_CONNECTED = 2;
  sync.SYNC_SYNCING = 3;
  sync.SYNC_ERROR = 4;

  // Intitially we are not connected
  sync.state = sync.SYNC_DISCONNECTED;

  sync.onError = function(err) {
    sync.state = sync.SYNC_ERROR;
    sync.emit('error', err);
  };

  sync.onDisconnected = function() {
    sync.state = sync.SYNC_DISCONNECTED;
    sync.emit('disconnected');
  };

  // Request that a sync begin for the specified path (optional).
  sync.request = function(path) {
    // If we're not connected (or are already syncing), ignore this request
    if(sync.state !== sync.SYNC_CONNECTED) {
      // TODO: https://github.com/mozilla/makedrive/issues/115
      return;
    }

    // Make sure the path exists, otherwise use root dir
    _fs.exists(path, function(exists) {
      path = exists ? path : '/';
      sync.manager.syncPath(path);
    });
  };

  // Try to connect to the server.
  sync.connect = function(url, token) {
    // Bail if we're already connected
    if(sync.state !== sync.SYNC_DISCONNECTED &&
       sync.state !== sync.ERROR) {
      // TODO: https://github.com/mozilla/makedrive/issues/117
      return;
    }

    // Also bail if we already have a SyncManager
    if(sync.manager) {
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
      sync.onCompleted = function() {
        needsSync = false;
        sync.state = sync.SYNC_CONNECTED;
        sync.emit('completed');
      };

      // Upgrade connection state to 'connected'
      sync.state = sync.SYNC_CONNECTED;
      sync.emit('connected');

      // If we're in manual mode, bail before starting auto-sync
      if(options.manual) {
        return;
      }

      // Start auto-sync'ing fs based on changes every 1 min.
      // TODO: https://github.com/mozilla/makedrive/issues/118
      watcher = _fs.watch('/', {recursive: true}, function(event, filename) {
        // Mark the fs as dirty, and we'll sync on next interval
        needsSync = true;

        // Also try to start a sync now, which might fail if we're already syncing.
        sync.request('/');
      });

      syncInterval = setInterval(function() {
        if(needsSync) {
          sync.request('/');
          needsSync = false;
        }
      }, 60 * 1000);
    }

    // Try to connect to provided server URL
    sync.manager = new SyncManager(sync, _fs);
    sync.manager.init(url, token, function(err) {
      if(err) {
        sync.onError(err);
        return;
      }

      // In a browser, try to clean-up after ourselves when window goes away
      if("onbeforeunload" in global) {
        sync.cleanupFn = function() {
          if(sync && sync.manager) {
            sync.manager.close();
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
  };

  // Disconnect from the server
  sync.disconnect = function() {
    // Remove our browser cleanup
    if("onbeforeunload" in global && sync.cleanupFn) {
      global.removeEventListener('beforeunload', sync.cleanupFn);
      sync.cleanupFn = null;
    }

    // Do a proper shutdown
    sync.manager.close();
    sync.manager = null;

    // Bail if we're not already connected
    if(sync.state === sync.SYNC_DISCONNECTED ||
       sync.state === sync.ERROR) {
      // TODO: https://github.com/mozilla/makedrive/issues/117
      return;
    }

    // Stop watching for fs changes, stop auto-sync'ing
    if(watcher) {
      watcher.close();
      watcher = null;
    }
    if(syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }

    sync.onDisconnected();
  };
}

// Manage single instance of a Filer filesystem with auto-sync'ing
MakeDrive.fs = function(options) {
  if(!_fs) {
    createFS(options || {});
  }

  return _fs;
};

// Expose bits of Filer that clients will need on MakeDrive
MakeDrive.Buffer = Filer.Buffer;
MakeDrive.Path = Filer.Path;
MakeDrive.Errors = Filer.Errors;
