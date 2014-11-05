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
 * - 'connected': a connection was established with the sync server. This
 * does not indicate that a sync has begun (use the 'syncing' event instead).
 *
 * - 'disconnected': the connection to the sync server was lost, either
 * due to the client or server.
 *
 * - 'syncing': a sync with the server has begun. A subsequent 'completed'
 * or 'error' event should follow at some point, indicating whether
 * or not the sync was successful.
 *
 * - 'idle': a sync was requested but no sync was performed. This usually
 * is triggered when no changes were made to the filesystem and hence, no
 * changes were needed to be synced to the server.
 *
 * - 'completed': a file/directory/symlink has been synced successfully.
 *
 * - 'synced': MakeDrive has been synced and all paths are up-to-date with
 * the server.
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
 * - request(): request a sync with the server.
 * Such requests may or may not be processed right away.
 *
 *
 * Finally, the `sync` propery also exposes a `state`, which is the
 * current sync state and can be one of:
 *
 * sync.SYNC_DISCONNECTED = "SYNC DISCONNECTED" (also the initial state)
 * sync.SYNC_CONNECTING = "SYNC CONNECTING"
 * sync.SYNC_CONNECTED = "SYNC CONNECTED"
 * sync.SYNC_SYNCING = "SYNC SYNCING"
 */

var SyncManager = require('./sync-manager.js');
var SyncFileSystem = require('./sync-filesystem.js');
var Filer = require('../../lib/filer.js');
var EventEmitter = require('events').EventEmitter;
var log = require('./logger.js');

var MakeDrive = {};

// Expose the logging api, so users can set log level
MakeDrive.log = log;

// Expose bits of Filer that clients will need on MakeDrive
MakeDrive.Buffer = Filer.Buffer;
MakeDrive.Path = Filer.Path;
MakeDrive.Errors = Filer.Errors;

module.exports = MakeDrive;

function createFS(options) {
  options.manual = options.manual === true;
  options.memory = options.memory === true;
  options.autoReconnect = options.autoReconnect !== false;

  // Use a supplied provider, in-memory RAM disk, or Fallback provider (default).
  if(options.memory) {
    log.debug('Using Filer Memory provider for fs');
    options.provider = new Filer.FileSystem.providers.Memory('makedrive');
  }
  if(!options.provider) {
    log.debug('Using Fallback provider for fs');
    options.provider = new Filer.FileSystem.providers.Fallback('makedrive');
  } else {
    log.debug('Using user-provided provider for fs', options.provider);
  }

  // Our fs instance is a modified Filer fs, with extra sync awareness
  // for conflict mediation, etc.  We keep an internal reference to the
  // raw Filer fs, and use the SyncFileSystem instance externally.
  var _fs = new Filer.FileSystem(options, function(err) {
    // FS creation errors will be logged for now for debugging purposes
    if(err) {
      log.error('Filesystem initialization error', err);
    }
  });
  var fs = new SyncFileSystem(_fs);
  var sync = fs.sync = new EventEmitter();
  var manager;
  Object.defineProperty(sync, 'downstreamQueue', {
    get: function() { return manager && manager.downstreams; }
  });

  // Auto-sync handles
  var autoSync;

  // State of the sync connection
  sync.SYNC_DISCONNECTED = "SYNC DISCONNECTED";
  sync.SYNC_CONNECTING = "SYNC CONNECTING";
  sync.SYNC_CONNECTED = "SYNC CONNECTED";
  sync.SYNC_SYNCING = "SYNC SYNCING";

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
    log.debug('Closing manager');
    manager.close();
    manager = null;
  }

  // Turn on auto-syncing if its not already on
  sync.auto = function(interval) {
    var syncInterval = interval|0 > 0 ? interval|0 : 15 * 1000;
    log.debug('Starting automatic syncing mode every ' + syncInterval + 'ms');

    if(autoSync) {
      clearInterval(autoSync);
    }

    autoSync = setInterval(sync.request, syncInterval);
  };

  // Turn off auto-syncing and turn on manual syncing
  sync.manual = function() {
    log.debug('Starting manual syncing mode');
    if(autoSync) {
      clearInterval(autoSync);
      autoSync = null;
    }
  };

  // The sync was stopped mid-way through.
  sync.onInterrupted = function(path) {
    sync.emit('error', new Error('Sync interrupted for path ' + path));
    log.warn('Sync interrupted by server for ' + path);
  };

  sync.onError = function(err) {
    sync.emit('error', err);
    log.error('Sync error', err);
  };

  sync.onIdle = function(reason) {
    sync.emit('idle', reason);
    log.info('No sync took place: ' + reason);
  };

  sync.onDisconnected = function() {
    // Remove listeners so we don't leak instance variables
    if("onbeforeunload" in global) {
      log.debug('Removing window.beforeunload handler');
      global.removeEventListener('beforeunload', windowCloseHandler);
    }
    if("onunload" in global){
      log.debug('Removing window.unload handler');
      global.removeEventListener('unload', cleanupManager);
    }

    sync.state = sync.SYNC_DISCONNECTED;
    sync.emit('disconnected');
    log.info('Disconnected from MakeDrive server');
  };

  // Request that a sync begin.
  // sync.request does not take any parameters
  // as the path to sync is determined internally
  sync.request = function() {
    if(sync.state === sync.SYNC_CONNECTING || sync.state === sync.SYNC_DISCONNECTED) {
      sync.emit('error', new Error('MakeDrive error: MakeDrive cannot sync as it is either disconnected or trying to connect'));
      log.warn('Tried to sync in invalid state: ' + sync.state);
      return;
    }

    log.info('Requesting sync');
    manager.syncUpstream();
  };

  // Try to connect to the server.
  sync.connect = function(url, token) {
    // Bail if we're already connected
    if(sync.state !== sync.SYNC_DISCONNECTED) {
      log.warn('Tried to connect, but already connected');
      return;
    }

    // Also bail if we already have a SyncManager
    if(manager) {
      return;
    }

    // Upgrade connection state to `connecting`
    log.info('Connecting to MakeDrive server');
    sync.state = sync.SYNC_CONNECTING;

    function connect(token) {
      // Try to connect to provided server URL. Use the raw Filer fs
      // instance for all rsync operations on the filesystem, so that we
      // can untangle changes done by user vs. sync code.
      manager = new SyncManager(sync, fs, _fs);

      manager.init(url, token, options, function(err) {
        if(err) {
          log.error('Error connecting to ' + url, err);
          sync.onError(err);
          return;
        }
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

        // Deals with race conditions if a sync was
        // started immediately after connecting before
        // this callback could be triggered
        if(sync.state !== sync.SYNC_SYNCING) {
          sync.state = sync.SYNC_CONNECTED;
          sync.emit('connected', url);
          log.info('MakeDrive connected to server at ' + url);
        }

        sync.onSyncing = function(path) {
          // A downstream sync might have just started,
          // update the queue
          sync.state = sync.SYNC_SYNCING;
          sync.emit('syncing', 'Sync started for ' + path);
          log.info('Sync started for ' + path);
        };

        // A sync (either upstream or downstream) has completed for a single
        // file/directory/symlink. The paths left to sync upstream needs to be
        // updated and an event should be emitted.
        sync.onCompleted = function(path, needsUpstream) {
          var downstreamQueue = manager.downstreams;
          needsUpstream = needsUpstream || [];

          // If during a downstream sync was performed and it was found that
          // the path is more up-to-date on the client and hence needs to be
          // upstreamed to the server, add it to the upstream queue.
          fs.appendPathsToSync(needsUpstream, function(err) {
            if(err) {
              sync.emit('error', err);
              log.error('Error appending paths to upstream after sync completed for ' + path + ' with error', err);
              return;
            }

            fs.getPathsToSync(function(err, pathsToSync) {
              var syncsLeft;

              if(err) {
                sync.emit('error', err);
                log.error('Error retrieving paths to sync after sync completed for ' + path + ' with error', err);
                return;
              }

              // Determine if there are any more syncs remaining (both upstream and downstream)
              syncsLeft = pathsToSync ? pathsToSync.concat(downstreamQueue) : downstreamQueue;

              if(path) {
                sync.emit('completed', path);
                log.info('Sync completed for ' + path);
              }

              if(!syncsLeft.length) {
                sync.allCompleted();
              }
            });
          });
        };

        // This is called when all nodes have been synced
        // upstream and all downstream syncs have completed
        sync.allCompleted = function() {
          if(sync.state !== sync.SYNC_DISCONNECTED) {
            // Reset the state
            sync.state = sync.SYNC_CONNECTED;
          }

          sync.emit('synced', 'MakeDrive has been synced');
          log.info('All syncs completed');
        };
      });
    }
    connect(token);
  };

  // Disconnect from the server
  sync.disconnect = function() {
    // Bail if we're not already connected
    if(sync.state === sync.SYNC_DISCONNECTED) {
      log.warn('Tried to disconnect while not connected');
      return;
    }

    // Stop auto-syncing
    if(autoSync) {
      clearInterval(autoSync);
      autoSync = null;
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
