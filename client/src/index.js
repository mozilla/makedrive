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
 * - interval=<Number> - by default, the filesystem syncs every 15 seconds if
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
 * - connect(url, [token]): try to connect to the specified sync server URL.
 * An 'error' or 'connected' event will follow, depending on success. If the
 * token parameter is provided, that authentication token will be used. Otherwise
 * the client will try to obtain one from the server's /api/sync route. This
 * requires the user to be authenticated previously with Webmaker.
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
 * sync.SYNC_DISCONNECTED = "SYNC DISCONNECTED" (also the initial state)
 * sync.SYNC_CONNECTING = "SYNC CONNECTING"
 * sync.SYNC_CONNECTED = "SYNC CONNECTED"
 * sync.SYNC_SYNCING = "SYNC SYNCING"
 * sync.SYNC_ERROR = "SYNC ERROR"
 */

var SyncManager = require('./sync-manager.js');
var SyncFileSystem = require('./sync-filesystem.js');
var Filer = require('../../lib/filer.js');
var EventEmitter = require('events').EventEmitter;
var resolvePath = require('../../lib/sync-path-resolver.js').resolveFromArray;

var MakeDrive = {};
module.exports = MakeDrive;

function createFS(options) {
  options.manual = options.manual === true;
  options.memory = options.memory === true;
  options.autoReconnect = options.autoReconnect !== false;

  // Use a supplied provider, in-memory RAM disk, or Fallback provider (default).
  if(options.memory) {
    options.provider = new Filer.FileSystem.providers.Memory('makedrive');
  }
  if(!options.provider) {
    options.provider = new Filer.FileSystem.providers.Fallback('makedrive');
  }

  // Our fs instance is a modified Filer fs, with extra sync awareness
  // for conflict mediation, etc.  We keep an internal reference to the
  // raw Filer fs, and use the SyncFileSystem instance externally.
  var _fs = new Filer.FileSystem(options, function(err) {
    // FS creation errors will be logged for now for debugging purposes
    if(err) {
      console.error('MakeDrive Filesystem Initialization Error: ', err);
    }
  });
  var fs = new SyncFileSystem(_fs);
  var sync = fs.sync = new EventEmitter();
  var manager;

  // Auto-sync handles
  var autoSync;
  var pathCache;

  // Path that needs to be used for an upstream sync
  // to sync files that were determined to be more 
  // up-to-date on the client during a downstream sync
  var upstreamPath;

  // State of the sync connection
  sync.SYNC_DISCONNECTED = "SYNC DISCONNECTED";
  sync.SYNC_CONNECTING = "SYNC CONNECTING";
  sync.SYNC_CONNECTED = "SYNC CONNECTED";
  sync.SYNC_SYNCING = "SYNC SYNCING";
  sync.SYNC_ERROR = "SYNC ERROR";

  // Intitially we are not connected
  sync.state = sync.SYNC_DISCONNECTED;

  // Optionally warn when closing the window if still syncing
  function windowCloseHandler(event) {
    if(!options.windowCloseWarning) {
      return;
    }

    if(sync.state !== sync.SYNC_SYNCING) {
      return;
    }

    var confirmationMessage = "Sync currently underway, are you sure you want to close?";
    (event || global.event).returnValue = confirmationMessage;

    return confirmationMessage;
  }

  function cleanupManager() {
    if(!manager) {
      return;
    }
    manager.close();
    manager = null;
  }

  function requestSync(path) {
    // If we're not connected (or are already syncing), ignore this request
    if(sync.state === sync.SYNC_DISCONNECTED || sync.state === sync.SYNC_ERROR) {
      sync.emit('error', new Error('Invalid state. Expected ' + sync.SYNC_CONNECTED + ', got ' + sync.state));
      return;
    }

    // If there were no changes to the filesystem and
    // no path was passed to sync, ignore this request
    if(!fs.pathToSync && !path) {
      return;
    }

    // If a path was passed sync using it
    if(path) {
      return manager.syncPath(path);
    }

    // Cache the path that needs to be synced for error recovery
    pathCache = fs.pathToSync;
    fs.pathToSync = null;
    manager.syncPath(pathCache);
  }

  // Turn on auto-syncing if its not already on
  sync.auto = function(interval) {
    var syncInterval = interval|0 > 0 ? interval|0 : 15 * 1000;

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

  // The server stopped our upstream sync mid-way through.
  sync.onInterrupted = function() {
    fs.pathToSync = pathCache;
    sync.state = sync.SYNC_CONNECTED;
    sync.emit('error', new Error('Sync interrupted by server.'));
  };

  sync.onError = function(err) {
    // Regress to the path that needed to be synced but failed
    // (likely because of a sync LOCK)
    fs.pathToSync = upstreamPath || pathCache;
    sync.state = sync.SYNC_ERROR;
    sync.emit('error', err);
  };

  sync.onDisconnected = function() {
    // Remove listeners so we don't leak instance variables
    if("onbeforeunload" in global) {
      global.removeEventListener('beforeunload', windowCloseHandler);
    }
    if("onunload" in global){
      global.removeEventListener('unload', cleanupManager);
    }

    sync.state = sync.SYNC_DISCONNECTED;
    sync.emit('disconnected');
  };

  // Request that a sync begin.
  sync.request = function() {
    // sync.request does not take any parameters
    // as the path to sync is determined internally
    // requestSync on the other hand optionally takes
    // a path to sync which can be specified for
    // internal use
    requestSync();
  };

  // Try to connect to the server.
  sync.connect = function(url, token) {
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

    function downstreamSyncCompleted(paths, needUpstream) {
      // Re-wire message handler functions for regular syncing
      // now that initial downstream sync is completed.
      sync.onSyncing = function() {
        sync.state = sync.SYNC_SYNCING;
        sync.emit('syncing');
      };

      sync.onCompleted = function(paths, needUpstream) {
        // If changes happened to the files that needed to be synced
        // during the sync itself, they will be overwritten
        // https://github.com/mozilla/makedrive/issues/129

        function complete() {
          sync.state = sync.SYNC_CONNECTED;
          sync.emit('completed');
        }

        if(!paths && !needUpstream) {
          return complete();
        }

        // Changes in the client are newer (determined during
        // the sync) and need to be upstreamed
        if(needUpstream) {
          upstreamPath = resolvePath(needUpstream);
          complete();
          return requestSync(upstreamPath);
        }

        // If changes happened during a downstream sync
        // Change the path that needs to be synced
        manager.resetUnsynced(paths, function(err) {
          if(err) {
            return sync.onError(err);
          }

          upstreamPath = null;
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

      // In a browser, try to clean-up after ourselves when window goes away
      if("onbeforeunload" in global) {
        global.addEventListener('beforeunload', windowCloseHandler);
      }
      if("onunload" in global){
        global.addEventListener('unload', cleanupManager);
      }

      sync.emit('connected');

      // If the downstream was completed and some
      // versions of files were not synced as they were
      // newer on the client, upstream them
      if(needUpstream) {
        upstreamPath = resolvePath(needUpstream);
        requestSync(upstreamPath);
      } else {
        upstreamPath = null;
      }
    }

    function connect(token) {
      // Try to connect to provided server URL. Use the raw Filer fs
      // instance for all rsync operations on the filesystem, so that we
      // can untangle changes done by user vs. sync code.
      manager = new SyncManager(sync, _fs);
      manager.init(url, token, options, function(err) {
        if(err) {
          sync.onError(err);
          return;
        }

        // Wait on initial downstream sync events to complete
        sync.onSyncing = function() {
          // do nothing, wait for onCompleted()
        };
        sync.onCompleted = function(paths, needUpstream) {
          // Downstream sync is done, finish connect() setup
          downstreamSyncCompleted(paths, needUpstream);
        };
      });
    }
    connect(token);
  };

  // Disconnect from the server
  sync.disconnect = function() {
    // Bail if we're not already connected
    if(sync.state === sync.SYNC_DISCONNECTED ||
       sync.state === sync.ERROR) {
      sync.emit('error', new Error("MakeDrive: Attempted to disconnect, but no server connection exists!"));
      return;
    }

    // Stop auto-syncing
    if(autoSync) {
      clearInterval(autoSync);
      autoSync = null;
      fs.pathToSync = null;
    }

    // Do a proper network shutdown
    cleanupManager();

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
