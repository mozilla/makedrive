var SyncMessage = require('../../lib/syncmessage');
var rsync = require('../../lib/rsync');
var diffHelper = require('../../lib/diff');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var SyncLock = require('./sync-lock.js');
var redis = require('../redis-clients.js');
var log = require('./logger.js');
var Constants = require('../../lib/constants.js');
var findPathIndexInArray = require('../../lib/util.js').findPathIndexInArray;
var ServerStates = Constants.server.states;
var rsyncOptions = Constants.rsyncDefaults;
var States = Constants.server.states;
var syncTypes = Constants.syncTypes;

var env = require('./environment.js');
var MAX_SYNC_SIZE_BYTES = env.get('MAX_SYNC_SIZE_BYTES') || Math.Infinity;

function SyncProtocolHandler(client) {
  EventEmitter.call(this);
  this.client = client;
}
util.inherits(SyncProtocolHandler, EventEmitter);

module.exports = SyncProtocolHandler;

/**
 * Common and utility methods
 */

// We hold a circular reference to the client instance, but break
// it when SyncProtocolHandler.close() is called. This is just an
// assertion to make sure we don't call things out of order.
function ensureClient(client) {
  var err;

  if(!client) {
    // Likely close() was called and now another step is happening
    // when it shouldn't. Create and log an error, so we get a stack
    // and can see why it happened.
    err = new Error('expected this.client to exist');
    log.error(err);
  }

  // If we're in an unexpected state for syncing (i.e., not a sync step), log that
  switch(client.state) {
    case ServerStates.CREATED:
    case ServerStates.CLOSED:
    case ServerStates.CLOSING:
    case ServerStates.CONNECTING:
    case ServerStates.ERROR:
      log.warn({client: client}, 'Unexpected client state for sync protocol handling: %s', client.state);
      break;
  }

  return client;
}

function getListOfSyncs(fs, callback) {
  var syncList = [];
  var sh = new fs.Shell();

  function trimTrailingSlash(path, next) {
    if(path === '/') {
      return next();
    }

    if(path.charAt(path.length - 1) === '/') {
      path = path.substring(0, path.length - 1);
    }

    syncList.push({path: path, type: syncTypes.CREATE});
    next();
  }

  sh.find('/', {exec: trimTrailingSlash}, function(err) {
    if(err) {
      return callback(err);
    }
    // Needs to be optimized as this array contains redundant syncs
    // For e.g. the array will contain [{path: '/dir'}, {path: '/dir/file'}]
    // In this case, the '/dir' entry can be removed because the sync for
    // '/dir/file' will create '/dir'
    callback(null, syncList);
  });
}

// Most upstream sync steps require a lock to be held.
// It's a bug if we get into one of these steps without the lock.
function ensureLock(client, path) {
  var lock = client.lock;
  if(!(lock && !('unlocked' in lock))) {
    // Create an error so we get a stack, too.
    var err = new Error('Attempted sync step without lock.');
    log.error({client: client, err: err}, 'Client should own lock but does not for ' + path);
    return false;
  }
  return true;
}

function releaseLock(client) {
  client.lock.removeAllListeners();
  client.lock = null;

  // Figure out how long this sync was active
  var startTime = client.upstreamSync.started;
  return Date.now() - startTime;
}

// Returns true if file sizes are all within limit, false if not.
// The client's lock is released, and an error sent to client in
// the false case.
function checkFileSizeLimit(client, srcList) {
  function maxSizeExceeded(obj) {
    var errorMsg;

    client.lock.release(function(err) {
      if(err) {
        log.error({err: err, client: client}, 'Error releasing sync lock');
      }

      releaseLock(client);

      errorMsg = SyncMessage.error.maxsizeExceeded;
      errorMsg.content = {path: obj.path};
      client.sendMessage(errorMsg);
    });
  }

  for (var key in srcList) {
    if(srcList.hasOwnProperty(key)) {
      var obj = srcList[key];
      for (var prop in obj) {
        if(obj.hasOwnProperty(prop) && prop === 'size') {
          if(obj.size > MAX_SYNC_SIZE_BYTES) {
            // Fail this sync, contains a file that is too large.
            log.warn({client: client},
                     'Client tried to exceed file sync size limit: file was %s bytes, limit is %s',
                     obj.size, MAX_SYNC_SIZE_BYTES);
            maxSizeExceeded(obj);
            return false;
          }
        }
      }
    }
  }

  return true;
}

function generateSourceListResponse(client, path, type, callback) {
  rsync.sourceList(client.fs, path, rsyncOptions, function(err, sourceList) {
    var response;

    if(err) {
      log.error({err: err, client: client}, 'rsync.sourceList() error for ' + path);
      response = SyncMessage.error.sourceList;
      response.content = {path: path, type: type};
    } else {
      response = SyncMessage.request.checksums;
      response.content = {path: path, type: type, sourceList: sourceList};
    }

    callback(err, response);
  });
}

function sendSourceList(client, syncInfo) {
  var syncInfoCopy = {};
  var response;

  if(syncInfo.type === syncTypes.RENAME) {
    // Make a copy so that we don't store the sync times in the
    // list of paths that need to be eventually synced
    Object.keys(syncInfo).forEach(function(key) {
      syncInfoCopy[key] = syncInfo[key];
    });

    syncInfoCopy._syncStarted = Date.now();
    client.currentDownstream.push(syncInfoCopy);
    response = SyncMessage.request.rename;
    response.content = {path: syncInfo.path, type: syncInfo.type, oldPath: syncInfo.oldPath};
    return client.sendMessage(response);
  }

  if(syncInfo.type === syncTypes.DELETE) {
    // Make a copy so that we don't store the sync times in the
    // list of paths that need to be eventually synced
    Object.keys(syncInfo).forEach(function(key) {
      syncInfoCopy[key] = syncInfo[key];
    });

    syncInfoCopy._syncStarted = Date.now();
    client.currentDownstream.push(syncInfoCopy);
    response = SyncMessage.request.del;
    response.content = {path: syncInfo.path, type: syncInfo.type};
    return client.sendMessage(response);
  }

  generateSourceListResponse(client, syncInfo.path, syncInfo.type, function(err, response) {
    if(!err) {
      // Make a copy so that we don't store the sync times in the
      // list of paths that need to be eventually synced
      Object.keys(syncInfo).forEach(function(key) {
        syncInfoCopy[key] = syncInfo[key];
      });

      syncInfoCopy._syncStarted = Date.now();
      client.currentDownstream.push(syncInfoCopy);
    }

    client.sendMessage(response);
  });
}

// Close and finalize the sync session
SyncProtocolHandler.prototype.close = function(callback) {
  var self = this;

  // We may or may not be able to cleanly close. If we can't yet
  // we wait on the closable event. See the rsync.patch step.
  self.client.state = States.CLOSING;

  // If we're still holding a valid lock, release it first.
  function maybeReleaseLock() {
    var lock = self.client.lock;

    function done(err) {
      log.debug({client: self.client}, 'Closed client sync handler');
      self.client.lock = null;
      self.client = null;
      callback(err);
    }

    // No lock
    if(!lock) {
      return done();
    }
    // Lock reference, but it's already unlocked
    if(lock.unlocked) {
      return done();
    }
    // Holding lock, release it
    lock.release(function(err) {
      if(err) {
        log.error({err: err, client: self.client}, 'Error releasing sync lock');
        return done(err);
      }
      done();
    });
  }

  // Wait on the client to become closable, if not already (see patch step).
  if(self.client.closable) {
    maybeReleaseLock();
  } else {
    self.once('closable', maybeReleaseLock);
  }
};

SyncProtocolHandler.prototype.handleMessage = function(message) {
  var client = ensureClient(this.client);

  if(message.is.request) {
    log.debug({syncMessage: message, client: client}, 'Received sync protocol Request message');
    this.handleRequest(message);
  } else if(message.is.response) {
    log.debug({syncMessage: message, client: client}, 'Received sync protocol Response message');
    this.handleResponse(message);
  } else {
    log.warn({client: client, syncMessage: message}, 'Invalid sync message sent by client, relaying it back');
    client.sendMessage(message);
  }
};

SyncProtocolHandler.prototype.handleRequest = function(message) {
  var client = ensureClient(this.client);

  if(message.is.diffs) {
    this.handleDiffRequest(message);
  } else if(message.is.sync) {
    this.handleSyncInitRequest(message);
  } else if(message.is.checksums) {
    this.handleChecksumRequest(message);
  } else if(message.is.delay) {
    this.handleDelayRequest(message);
  } else if(message.is.rename) {
    this.handleRenameRequest(message);
  } else if(message.is.del) {
    this.handleDeleteRequest(message);
  } else {
    log.warn({syncMessage: message, client: client}, 'Client sent unknown request');
  }
};

SyncProtocolHandler.prototype.handleResponse = function(message) {
  var client = ensureClient(this.client);

  if(message.is.authz) {
    this.handleFullDownstream(message);
  } else if(message.is.diffs) {
    this.handleDiffResponse(message);
  } else if(message.is.patch) {
    this.handlePatchResponse(message);
  } else if(message.is.root) {
    this.handleRootResponse(message);
  } else {
    log.warn({syncMessage: message, client: client}, 'Client sent unknown response');
  }
};

/**
 * Upstream Sync Steps
 */

SyncProtocolHandler.prototype.handleSyncInitRequest = function(message) {
  var client = ensureClient(this.client);
  var response;
  var path;
  var type;
  var comparePath;

  if(!client) {
    return;
  }

  if(message.invalidContent(['type'])) {
    log.warn({client: client, syncMessage: message}, 'Missing content.path or content.type expected by handleSyncInitRequest()');
    response = SyncMessage.error.content;
    return client.sendMessage(response);
  }

  path = message.content.path;
  type = message.content.type;
  comparePath = type === syncTypes.RENAME ? message.content.oldPath : path;

  // Check if the client has not downstreamed the file for which an upstream
  // sync was requested.
  if(findPathIndexInArray(client.outOfDate, comparePath) !== -1) {
    log.debug({client: client}, 'Upstream sync declined as downstream is required for ' + comparePath);
    response = SyncMessage.error.needsDownstream;
    response.content = {path: comparePath, type: type};
    client.sendMessage(response);
    // Force the client to downstream that path
    return sendSourceList(client, {path: comparePath});
  }

  SyncLock.request(client, comparePath, function(err, lock) {
    if(err) {
      log.error({err: err, client: client}, 'SyncLock.request() error');
      response = SyncMessage.error.impl;
      response.content = {path: path, type: type};
    } else {
      if(lock) {
        log.debug({client: client, syncLock: lock}, 'Lock request successful, lock acquired for ' + comparePath);

        lock.once('unlocked', function() {
          log.debug({client: client, syncLock: lock}, 'Lock unlocked for ' + lock.path);
          releaseLock(client);

          var interruptedResponse = SyncMessage.error.interrupted;
          interruptedResponse.content = {path: lock.path};
          client.sendMessage(interruptedResponse);
        });

        client.lock = lock;

        // Track the length of time this sync takes
        client.upstreamSync = {path: path, type: type, started: Date.now()};

        response = SyncMessage.response.sync;
        response.content = {path: path, type: type};

        if(type === syncTypes.RENAME) {
          client.upstreamSync.oldPath = comparePath;
          response.content.oldPath = comparePath;
        }
      } else {
        log.debug({client: client}, 'Lock request unsuccessful, lock denied for ' + comparePath);
        response = SyncMessage.error.locked;
        response.content = {error: 'Sync already in progress', path: path, type: type};
      }
    }

    client.sendMessage(response);
  });
};

SyncProtocolHandler.prototype.handleRenameRequest = function(message) {
  var client = ensureClient(this.client);
  var response;
  var path;
  var oldPath;
  var type;
  var sync = this;

  if(!client) {
    return;
  }

  if(message.invalidContent(['oldPath', 'type'])) {
    log.warn({client: client, syncMessage: message}, 'Missing path or old path expected by handleRenameRequest()');
    response = SyncMessage.error.content;
    return client.sendMessage(response);
  }

  path = message.content.path;
  oldPath = message.content.oldPath;
  type = message.content.type;

  if(!ensureLock(client, oldPath)) {
    return;
  }

  // Called when the client is closable again
  function closable() {
    client.closable = true;
    sync.emit('closable');
  }

  client.closable = false;

  rsync.utils.rename(client.fs, oldPath, path, function(err) {
    if(err) {
      log.error({err: err, client: client}, 'rsync.utils.rename() error when renaming ' + oldPath + ' to ' + path);
      client.lock.release(function(err) {
        if(err) {
          log.error({err: err, client: client}, 'Error releasing sync lock');
        }

        releaseLock(client);

        response = SyncMessage.error.rename;
        response.content = {path: path, oldPath: oldPath};
        client.sendMessage(response);
        closable();
      });
    } else {
      response = SyncMessage.response.patch;
      response.content = {path: path, oldPath: oldPath, type: type};
      sync.end(response);
      closable();
    }
  });
};

SyncProtocolHandler.prototype.handleDeleteRequest = function(message) {
  var client = ensureClient(this.client);
  var response;
  var path;
  var type;
  var sync = this;

  if(!client) {
    return;
  }

  if(message.invalidContent(['type'])) {
    log.warn({client: client, syncMessage: message}, 'Missing path or type expected by handleRenameRequest()');
    response = SyncMessage.error.content;
    return client.sendMessage(response);
  }

  path = message.content.path;
  type = message.content.type;

  if(!ensureLock(client, path)) {
    return;
  }

  // Called when the client is closable again
  function closable() {
    client.closable = true;
    sync.emit('closable');
  }

  client.closable = false;

  rsync.utils.del(client.fs, path, function(err) {
    if(err) {
      log.error({err: err, client: client}, 'rsync.utils.del() error when deleting ' + path);
      client.lock.release(function(err) {
        if(err) {
          log.error({err: err, client: client}, 'Error releasing sync lock');
        }

        releaseLock(client);

        response = SyncMessage.error.del;
        response.content = {path: path};
        client.sendMessage(response);
        closable();
      });
    } else {
      response = SyncMessage.response.patch;
      response.content = {path: path, type: type};
      sync.end(response);
      closable();
    }
  });
};

SyncProtocolHandler.prototype.handleChecksumRequest = function(message) {
  var client = ensureClient(this.client);
  var response;
  var path;
  var type;
  var sourceList;

  if(!client) {
    return;
  }

  if(message.invalidContent(['type', 'sourceList'])) {
    log.warn({client: client, syncMessage: message}, 'Missing path, type or sourceList expected by handleChecksumRequest()');
    response = SyncMessage.error.content;
    return client.sendMessage(response);
  }

  path = message.content.path;
  type = message.content.type;
  sourceList = message.content.sourceList;

  if(!ensureLock(client, path)) {
    return;
  }

  // Enforce sync file size limits (if set in .env)
  if(!checkFileSizeLimit(client, sourceList)) {
    return;
  }

  rsync.checksums(client.fs, path, sourceList, rsyncOptions, function(err, checksums) {
    if(err) {
      log.error({err: err, client: client}, 'rsync.checksums() error');
      client.lock.release(function(err) {
        if(err) {
          log.error({err: err, client: client}, 'Error releasing sync lock');
        }

        releaseLock(client);

        response = SyncMessage.error.checksums;
        response.content = {path: path, type: type};
        client.sendMessage(response);
      });
    } else {
      response = SyncMessage.request.diffs;
      response.content = {path: path, type: type, checksums: checksums};
      client.sendMessage(response);
    }
  });
};

SyncProtocolHandler.prototype.handleDiffResponse = function(message) {
  var client = ensureClient(this.client);
  var sync = this;
  var response;
  var path;
  var type;
  var diffs;

  if(!client) {
    return;
  }

  if(message.invalidContent(['type', 'diffs'])) {
    log.warn({client: client, syncMessage: message}, 'Missing path, type or diffs expected by handleDiffResponse()');
    response = SyncMessage.error.content;
    return client.sendMessage(response);
  }

  path = message.content.path;
  type = message.content.type;
  diffs = diffHelper.deserialize(message.content.diffs);

  if(!ensureLock(client, path)) {
    return;
  }

  // Called when the client is closable again
  function closable() {
    client.closable = true;
    sync.emit('closable');
  }

  // Flag that changes are being made to the filesystem,
  // preventing actions that could interrupt this process
  // and corrupt data.
  try {
    // Block attempts to stop this sync until the patch completes.
    client.closable = false;
    rsync.patch(client.fs, path, diffs, rsyncOptions, function(err) {
      if(err) {
        log.error({err: err, client: client}, 'rsync.patch() error');
        client.lock.release(function(err) {
          if(err) {
            log.error({err: err, client: client}, 'Error releasing sync lock for ' + path);
          }

          releaseLock(client);

          response = SyncMessage.error.patch;
          response.content = {path: path, type: type};
          client.sendMessage(response);
          closable();
        });
      } else {
        response = SyncMessage.response.patch;
        response.content = {path: path, type: type};
        sync.end(response);
        closable();
      }
    });
  } catch(e) {
    // Handle rsync failing badly on a patch step
    // TODO: https://github.com/mozilla/makedrive/issues/31
    log.error({err: e, client: client}, 'rsync.patch() error on ' + path);
  }
};

// End a completed sync for a client
SyncProtocolHandler.prototype.end = function(patchResponse) {
  var self = this;
  var client = ensureClient(this.client);
  var path = patchResponse.content.path;
  var type = patchResponse.content.type;

  if(!client) {
    return;
  }
  if(!ensureLock(client, path)) {
    return;
  }

  client.lock.release(function(err) {
    if(err) {
      log.error({err: err, client: client}, 'Error releasing lock for ' + path);
    }

    var duration = releaseLock(client);
    client.upstreamSync = null;
    var info = client.info();
    if(info) {
      info.upstreamSyncs++;
    }
    log.info({client: client}, 'Completed upstream sync to server for ' + path + ' in %s ms.', duration);

    client.sendMessage(patchResponse);

    // Also let all other connected clients for this user know that
    // they are now out of date, and need to do a downstream sync.
    self.broadcastUpdate(path, type, patchResponse.content.oldPath);
  });
};

// Broadcast an out-of-date message to the all clients for a given user
// other than the active sync client after an upstream sync process has completed.
// Also, if any downstream syncs were interrupted during this upstream sync,
// they will be retriggered when the message is received.
SyncProtocolHandler.prototype.broadcastUpdate = function(path, type, oldPath) {
  var client = ensureClient(this.client);
  if(!client) {
    return;
  }

  // Send a message indicating the username and client that just updated,
  // as well as the default SyncMessage to broadcast. All other connected
  // clients for that username will need to sync (downstream) to get the
  // new updates.
  var msg = {
    username: client.username,
    id: client.id,
    path: path,
    type: type,
    oldPath: oldPath
  };

  log.debug({client: client, syncMessage: msg}, 'Broadcasting out-of-date');
  redis.publish(Constants.server.syncChannel, JSON.stringify(msg));
};

/**
 * Downstream Sync Steps
 */

SyncProtocolHandler.prototype.syncDownstream = function() {
  var client = ensureClient(this.client);
  if(!client) {
    return;
  }

  var syncs = client.outOfDate;

  // For each path in the filesystem, generate the source list and
  // trigger a downstream sync
  syncs.forEach(function(syncInfo) {
    sendSourceList(client, syncInfo);
  });
};

SyncProtocolHandler.prototype.handleFullDownstream = function() {
  var client = ensureClient(this.client);

  getListOfSyncs(client.fs, function(err, syncs) {
    if(err) {
      log.error({err: err, client: client}, 'fatal error generating list of syncs to occur in handleFullDownstream');
      return;
    }

    // Nothing in the filesystem, so nothing to sync
    if(!syncs || !syncs.length) {
      return client.sendMessage(SyncMessage.response.verification);
    }

    client.outOfDate = syncs;
    client.currentDownstream = [];

    client.handler.syncDownstream();
  });
};

SyncProtocolHandler.prototype.handleRootResponse = function(message) {
  var client = ensureClient(this.client);
  if(!client) {
    return;
  }

  if(message.invalidContent()) {
    log.warn({client: client, syncMessage: message}, 'Missing content.path expected by handleRootResponse');
    return client.sendMessage(SyncMessage.error.content);
  }

  var path = message.content.path;
  var currentDownstreams = client.currentDownstream;
  var remainingDownstreams = client.outOfDate;
  var indexInCurrent = findPathIndexInArray(currentDownstreams, path);
  var indexInOutOfDate = findPathIndexInArray(remainingDownstreams, path);

  if(indexInCurrent === -1) {
    log.warn({client: client, syncMessage: message}, 'Client sent a path in handleRootResponse that is not currently downstreaming');
    return;
  }

  client.currentDownstream.splice(indexInCurrent, 1);
  client.outOfDate.splice(indexInOutOfDate, 1);
  log.info({client: client}, 'Ignored downstream sync due to ' + path + ' being out of client\'s root');
};

SyncProtocolHandler.prototype.handleDelayRequest = function(message) {
  var client = ensureClient(this.client);
  if(!client) {
    return;
  }

  if(message.invalidContent()) {
    log.warn({client: client, syncMessage: message}, 'Missing content.path expected by handleDelayRequest');
    return client.sendMessage(SyncMessage.error.content);
  }

  client.delaySync(message.content.path);
};

SyncProtocolHandler.prototype.handleDiffRequest = function(message) {
  var client = ensureClient(this.client);
  var response;
  var path;
  var type;
  var checksums;

  if(!client) {
    return;
  }

  if(message.invalidContent(['type', 'checksums'])) {
    log.warn({client: client, syncMessage: message}, 'Missing content.checksums in handleDiffRequest()');
    return client.sendMessage(SyncMessage.error.content);
  }

  path = message.content.path;
  type = message.content.type;

  // We reject downstream sync SyncMessages unless
  // no upstream sync for that path is in progress.
  SyncLock.isUserLocked(client.username, path, function(err, locked) {
    if(err) {
      log.error({err: err, client: client}, 'Error trying to look-up lock for user with redis');
      client.delaySync(path);
      response = SyncMessage.error.diffs;
      response.content = {path: path, type: type};
      client.sendMessage(response);
      return;
    }

    if(locked) {
      response = SyncMessage.error.downstreamLocked;
      response.content = {path: path, type: type};
      client.delaySync(path);
      client.sendMessage(response);
      return;
    }

    checksums = message.content.checksums;

    rsync.diff(client.fs, path, checksums, rsyncOptions, function(err, diffs) {
      if(err) {
        log.error({err: err, client: client}, 'rsync.diff() error for ' + path);
        client.delaySync(path);
        response = SyncMessage.error.diffs;
        response.content = {path: path, type: type};
      } else {
        response = SyncMessage.response.diffs;
        response.content = {
          diffs: diffHelper.serialize(diffs),
          path: path,
          type: type
        };
      }

      client.sendMessage(response);
    });
  });
};

SyncProtocolHandler.prototype.handlePatchResponse = function(message) {
  var client = ensureClient(this.client);

  if(!client) {
    return;
  }

  if(message.invalidContent(['type', 'checksum'])) {
    log.warn({client: client, syncMessage: message}, 'Missing content.type or content.checksum in handlePatchResponse()');
    return client.sendMessage(SyncMessage.error.content);
  }

  var checksum = message.content.checksum;
  var type = message.content.type;
  var path = message.content.path;

  rsync.utils.compareContents(client.fs, checksum, function(err, equal) {
    var response;

    // We need to check if equal is true because equal can have three possible
    // return value. 1. equal = true, 2. equal = false, 3. equal = undefined
    // we want to send error verification in case of err return or equal is false.
    if(equal) {
      response = SyncMessage.response.verification;
      client.endDownstream(path);
    } else {
      response = SyncMessage.error.verification;
    }

    response.content = {path: path, type: type};

    var info = client.info();
    if(info) {
      info.downstreamSyncs++;
    }

    client.sendMessage(response);
  });
};
