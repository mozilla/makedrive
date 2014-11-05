var SyncMessage = require('../../lib/syncmessage');
var rsync = require('../../lib/rsync');
var rsyncUtils = rsync.utils;
var rsyncOptions = require('../../lib/constants').rsyncDefaults;
var syncTypes = require('../../lib/constants').syncTypes;
var serializeDiff = require('../../lib/diff').serialize;
var deserializeDiff = require('../../lib/diff').deserialize;
var fsUtils = require('../../lib/fs-utils');
var log = require('./logger.js');
var findPathIndexInArray = require('../../lib/util.js').findPathIndexInArray;

function onError(syncManager, err) {
  syncManager.sync.onError(err);
}

function sendChecksums(syncManager, path, type, sourceList) {
  var fs = syncManager.fs;
  var rawFs = syncManager.rawFs;
  var sync = syncManager.sync;
  var message;

  // If the server requests to downstream a path that is not in the
  // root, ignore the downstream.
  if(path.indexOf(fs.root) !== 0) {
    message = SyncMessage.response.root;
    message.content = {path: path, type: type};
    log.info('Ignoring ' + type + ' downstream sync for ' + path);
    return syncManager.send(message.stringify());
  }

  syncManager.downstreams.push(path);
  sync.onSyncing(path);

  rsync.checksums(rawFs, path, sourceList, rsyncOptions, function(err, checksums) {
    if(err) {
      log.error('Failed to generate checksums for ' + path + ' during downstream sync', err);
      message = SyncMessage.request.delay;
      message.content = {path: path, type: type};
      syncManager.send(message.stringify());
      return onError(syncManager, err);
    }

    fs.trackChanges(path, sourceList);
    message = SyncMessage.request.diffs;
    message.content = {path: path, type: type, checksums: checksums};
    syncManager.send(message.stringify());
  });
}

function handleRequest(syncManager, data) {
  var fs = syncManager.fs;
  var rawFs = syncManager.rawFs;
  var sync = syncManager.sync;

  function handleChecksumRequest() {
    if(data.invalidContent(['type', 'sourceList'])) {
      log.error('Path, type or source list not sent by server in handleChecksumRequest.', data);
      return onError(syncManager, new Error('Server sent insufficient content'));
    }

    sendChecksums(syncManager, data.content.path, data.content.type, data.content.sourceList);
  }

  function handleDiffRequest() {
    if(data.invalidContent(['type', 'checksums'])) {
      log.warn(data, 'Upstream sync message received from the server without sufficient information in handleDiffRequest');
      fs.delaySync(function(err, path) {
        if(err) {
          log.error(err, 'An error occured while updating paths to sync in handleDiffRequest');
          return onError(syncManager, err);
        }

        log.info('Sync delayed for ' + path + ' in handleDiffRequest');
        syncManager.currentSync = false;
        syncManager.syncUpstream();
      });
      return;
    }

    var path = data.content.path;
    var type = data.content.type;
    var checksums = data.content.checksums;
    var message;

    rsync.diff(rawFs, path, checksums, rsyncOptions, function(err, diffs) {
      if(err){
        log.error(err, 'Error generating diffs in handleDiffRequest for ' + path);

        fs.delaySync(function(delayErr, delayedPath) {
          if(delayErr) {
            log.error(err, 'Error updating paths to sync in handleDiffRequest after failing to generate diffs for ' + path);
            return onError(syncManager, delayErr);
          }

          log.info('Sync delayed for ' + delayedPath + ' in handleDiffRequest');
          syncManager.currentSync = false;
          syncManager.syncUpstream();
        });
      } else {
        message = SyncMessage.response.diffs;
        message.content = {path: path, type: type, diffs: serializeDiff(diffs)};
        syncManager.send(message.stringify());
      }
    });
  }

  function handleRenameRequest() {
    if(data.invalidContent(['type', 'oldPath'])) {
      log.error('Path, type or old path not sent by server in handleRenameRequest.', data);
      return onError(syncManager, new Error('Server sent insufficient content'));
    }

    var path = data.content.path;
    var oldPath = data.content.oldPath;
    var type = data.content.type;
    var message;

    // If the server requests to downstream a path that is not in the
    // root, ignore the downstream.
    if(path.indexOf(fs.root) !== 0) {
      message = SyncMessage.response.root;
      message.content = {path: path};
      log.info('Ignoring downstream sync for ' + path);
      return syncManager.send(message.stringify());
    }

    syncManager.downstreams.push(path);
    sync.onSyncing(oldPath);

    rsyncUtils.rename(rawFs, oldPath, path, function(err) {
      if(err) {
        log.error('Failed to rename ' + oldPath + ' to ' + path + ' during downstream sync', err);
        message = SyncMessage.request.delay;
        message.content = {path: path, type: type};
        syncManager.send(message.stringify());
        return onError(syncManager, err);
      }

      rsyncUtils.generateChecksums(rawFs, [path], true, function(err, checksum) {
        if(err) {
          log.error('Failed to generate checksums for ' + path + ' during downstream rename', err);
          message = SyncMessage.request.delay;
          message.content = {path: path, type: type};
          syncManager.send(message.stringify());
          return onError(syncManager, err);
        }

        message = SyncMessage.response.patch;
        message.content = {path: path, type: type, checksum: checksum};
        syncManager.send(message.stringify());
      });
    });
  }

  function handleDeleteRequest() {
    if(data.invalidContent(['type'])) {
      log.error('Path or type not sent by server in handleRenameRequest.', data);
      return onError(syncManager, new Error('Server sent insufficient content'));
    }

    var path = data.content.path;
    var type = data.content.type;
    var message;

    // If the server requests to downstream a path that is not in the
    // root, ignore the downstream.
    if(path.indexOf(fs.root) !== 0) {
      message = SyncMessage.response.root;
      message.content = {path: path, type: type};
      log.info('Ignoring downstream sync for ' + path);
      return syncManager.send(message.stringify());
    }

    syncManager.downstreams.push(path);
    sync.onSyncing(path);

    rsyncUtils.del(rawFs, path, function(err) {
      if(err) {
        log.error('Failed to delete ' + path + ' during downstream sync', err);
        message = SyncMessage.request.delay;
        message.content = {path: path, type: type};
        syncManager.send(message.stringify());
        return onError(syncManager, err);
      }

      rsyncUtils.generateChecksums(rawFs, [path], false, function(err, checksum) {
        if(err) {
          log.error('Failed to generate checksums for ' + path + ' during downstream delete', err);
          message = SyncMessage.request.delay;
          message.content = {path: path, type: type};
          syncManager.send(message.stringify());
          return onError(syncManager, err);
        }

        message = SyncMessage.response.patch;
        message.content = {path: path, type: type, checksum: checksum};
        syncManager.send(message.stringify());
      });
    });
  }

  if(data.is.checksums) {
    // DOWNSTREAM - CHKSUM
    handleChecksumRequest();
  } else if(data.is.diffs) {
    // UPSTREAM - DIFFS
    handleDiffRequest();
  } else if(data.is.rename) {
    // DOWNSTREAM - RENAME
    handleRenameRequest();
  } else if(data.is.del) {
    // DOWNSTREAM - DELETE
    handleDeleteRequest();
  } else {
    onError(syncManager, new Error('Failed to sync with the server.'));
  }
}

function handleResponse(syncManager, data) {
  var fs = syncManager.fs;
  var rawFs = syncManager.rawFs;
  var sync = syncManager.sync;

  function handleSourceListResponse() {
    if(data.invalidContent(['type'])) {
      log.warn(data, 'Upstream sync message received from the server without sufficient information in handleSourceListResponse');
      return fs.delaySync(function(err, path) {
        if(err) {
          log.error(err, 'An error occured while updating paths to sync in handleSourceListResponse');
          return onError(syncManager, err);
        }

        log.info('Sync delayed for ' + path + ' in handleSourceListResponse');
        syncManager.currentSync = false;
        syncManager.syncUpstream();
      });
    }

    var message;
    var path = data.content.path;
    var type = data.content.type;

    sync.onSyncing(path);

    if(type === syncTypes.RENAME) {
      message = SyncMessage.request.rename;
      message.content = {path: path, oldPath: data.content.oldPath, type: type};
      return syncManager.send(message.stringify());
    }

    if(type === syncTypes.DELETE) {
      message = SyncMessage.request.del;
      message.content = {path: path, type: type};
      return syncManager.send(message.stringify());
    }

    rsync.sourceList(rawFs, path, rsyncOptions, function(err, sourceList) {
      if(err){
        log.error(err, 'Error generating source list in handleSourceListResponse for ' + path);
        return fs.delaySync(function(delayErr, delayedPath) {
          if(delayErr) {
            log.error(err, 'Error updating paths to sync in handleSourceListResponse after failing to generate source list for ' + path);
            return onError(syncManager, delayErr);
          }

          log.info('Sync delayed for ' + delayedPath + ' in handleSourceListResponse');
          syncManager.currentSync = false;
          syncManager.syncUpstream();
        });
      }

      message = SyncMessage.request.checksums;
      message.content = {path: path, type: type, sourceList: sourceList};
      syncManager.send(message.stringify());
    });
  }

  // As soon as an upstream sync happens, the file synced
  // becomes the last synced version and must be stamped
  // with its checksum to version it and the unsynced attribute
  // must be removed
  function handlePatchAckResponse() {
    var syncedPath = data.content.path;

    function complete() {
      fsUtils.removeUnsynced(fs, syncedPath, function(err) {
        if(err && err.code !== 'ENOENT') {
          log.error('Failed to remove unsynced attribute for ' + syncedPath + ' in handlePatchAckResponse, complete()');
        }

        syncManager.syncNext(syncedPath);
      });
    }

    fs.lstat(syncedPath, function(err, stats) {
      if(err) {
        if(err.code !== 'ENOENT') {
          log.error('Failed to access ' + syncedPath + ' in handlePatchAckResponse');
          return fs.delaySync(function(delayErr, delayedPath) {
            if(delayErr) {
              log.error('Failed to delay upstream sync for ' + delayedPath + ' in handlePatchAckResponse');
            }
            onError(syncManager, err);
          });
        }

        // Non-existent paths usually due to renames or
        // deletes cannot be stamped with a checksum
        return complete();
      }

      if(!stats.isFile()) {
        return complete();
      }

      rsyncUtils.getChecksum(rawFs, syncedPath, function(err, checksum) {
        if(err) {
          log.error('Failed to get the checksum for ' + syncedPath + ' in handlePatchAckResponse');
          return fs.delaySync(function(delayErr, delayedPath) {
            if(delayErr) {
              log.error('Failed to delay upstream sync for ' + delayedPath + ' in handlePatchAckResponse while getting checksum');
            }
            onError(syncManager, err);
          });
        }

        fsUtils.setChecksum(rawFs, syncedPath, checksum, function(err) {
          if(err) {
            log.error('Failed to stamp the checksum for ' + syncedPath + ' in handlePatchAckResponse');
            return fs.delaySync(function(delayErr, delayedPath) {
              if(delayErr) {
                log.error('Failed to delay upstream sync for ' + delayedPath + ' in handlePatchAckResponse while setting checksum');
              }
              onError(syncManager, err);
            });
          }

          complete();
        });
      });
    });
  }

  function handleDiffResponse() {
    var message;

    if(data.invalidContent(['type', 'diffs'])) {
      log.error('Path, type or diffs not sent by server in handleDiffResponse.', data);
      return onError(syncManager, new Error('Server sent insufficient content'));
    }

    var path = data.content.path;
    var type = data.content.type;
    var diffs = deserializeDiff(data.content.diffs);
    var changedDuringDownstream = fs.changesDuringDownstream.indexOf(path);
    var cachedSourceList = fs.untrackChanges(path);

    if(changedDuringDownstream !== -1) {
      // Resend the checksums for that path
      return sendChecksums(syncManager, path, type, cachedSourceList);
    }

    rsync.patch(rawFs, path, diffs, rsyncOptions, function(err, paths) {
      if(err) {
        log.error('Failed to patch ' + path + ' during downstream sync', err);
        message = SyncMessage.request.delay;
        message.content = {path: path, type: type};
        syncManager.send(message.stringify());
        return onError(syncManager, err);
      }

      var needsUpstream = paths.needsUpstream;
      syncManager.needsUpstream = syncManager.needsUpstream || [];
      syncManager.needsUpstream.forEach(function(upstreamPath) {
        if(needsUpstream.indexOf(upstreamPath) === -1) {
          syncManager.needsUpstream.push(upstreamPath);
        }
      });

      fsUtils.getPathsToSync(rawFs, fs.root, function(err, pathsToSync) {
        if(err) {
          log.error('Failed to update paths to sync during downstream sync', err);
          message = SyncMessage.request.delay;
          message.content = {path: path, type: type};
          syncManager.send(message.stringify());
          return onError(syncManager, err);
        }

        var indexInPathsToSync;

        if(pathsToSync && pathsToSync.toSync && needsUpstream.indexOf(path) === -1) {
          indexInPathsToSync = findPathIndexInArray(pathsToSync.toSync, path);
          if(indexInPathsToSync !== -1) {
            pathsToSync.toSync.splice(indexInPathsToSync, 1);
          }
        }

        fsUtils.setPathsToSync(rawFs, fs.root, pathsToSync, function(err) {
          if(err) {
            log.error('Failed to update paths to sync during downstream sync', err);
            message = SyncMessage.request.delay;
            message.content = {path: path, type: type};
            syncManager.send(message.stringify());
            return onError(syncManager, err);
          }

          rsyncUtils.generateChecksums(rawFs, paths.synced, true, function(err, checksum) {
            if(err) {
              log.error('Failed to generate checksums for ' + paths.synced + ' during downstream patch', err);
              message = SyncMessage.request.delay;
              message.content = {path: path, type: type};
              syncManager.send(message.stringify());
              return onError(syncManager, err);
            }

            message = SyncMessage.response.patch;
            message.content = {path: path, type: type, checksum: checksum};
            syncManager.send(message.stringify());
          });
        });
      });
    });
  }

  function handleVerificationResponse() {
    var path = data.content && data.content.path;
    syncManager.downstreams.splice(syncManager.downstreams.indexOf(path), 1);
    sync.onCompleted(path, syncManager.needsUpstream);
  }

  if(data.is.sync) {
    // UPSTREAM - INIT
    handleSourceListResponse();
  } else if(data.is.patch) {
    // UPSTREAM - PATCH
    handlePatchAckResponse();
  } else if(data.is.diffs) {
    // DOWNSTREAM - PATCH
    handleDiffResponse();
  } else if(data.is.verification) {
    // DOWNSTREAM - PATCH VERIFICATION
    handleVerificationResponse();
  }  else {
    onError(syncManager, new Error('Failed to sync with the server.'));
  }
}

function handleError(syncManager, data) {
  var sync = syncManager.sync;
  var fs = syncManager.fs;
  var path = data.content && data.content.path;

  function handleForcedDownstream() {
    fs.dequeueSync(function(err, syncsLeft, removedPath) {
      if(err) {
        log.fatal('Fatal error trying to dequeue sync in handleForcedDownstream');
        return;
      }

      syncManager.currentSync = false;
      sync.onInterrupted(removedPath);
    });
  }

  function handleUpstreamError() {
    fs.delaySync(function(err, delayedPath) {
      if(err) {
        log.fatal('Fatal error trying to delay sync in handleUpstreamError');
        return;
      }

      syncManager.currentSync = false;
      sync.onInterrupted(delayedPath);
    });
  }

  function handleDownstreamError() {
    if(syncManager.downstreams && syncManager.downstreams.length) {
      syncManager.downstreams.splice(syncManager.downstreams.indexOf(path), 1);
    }

    fs.untrackChanges(path);
    sync.onInterrupted(path);
  }

  if(data.is.content) {
    log.error('Invalid content was sent to the server');
  } else if(data.is.needsDownstream) {
    log.warn('Cancelling upstream for ' + path + ', downstreaming instead');
    handleForcedDownstream();
  } else if(data.is.impl) {
    log.error('Server could not initialize upstream sync for ' + path);
    handleUpstreamError();
  } else if(data.is.interrupted) {
    log.error('Server interrupted upstream sync due to incoming downstream for ' + path);
    handleUpstreamError();
  } else if(data.is.locked) {
    log.error('Server cannot process upstream request due to ' + path + ' being locked');
    handleUpstreamError();
  } else if(data.is.fileSizeError) {
    log.error('Maximum file size for upstream syncs exceeded for ' + path);
    handleUpstreamError();
  } else if(data.is.checksums) {
    log.error('Error generating checksums on the server for ' + path);
    handleUpstreamError();
  } else if(data.is.patch) {
    log.error('Error patching ' + path + ' on the server');
    handleUpstreamError();
  } else if(data.is.sourceList) {
    log.fatal('Fatal error, server could not generate source list');
  } else if(data.is.diffs) {
    log.error('Error generating diffs on the server for ' + path);
    handleDownstreamError();
  } else if(data.is.downstreamLocked) {
    log.error('Cannot downstream due to lock on ' + path + ' on the server');
    handleDownstreamError();
  } else if(data.is.verification) {
    log.fatal('Patch could not be verified due to incorrect patching on downstreaming ' + path + '. Possible file corruption.');
    handleDownstreamError();
  } else {
    log.fatal(data, 'Unknown error sent by the server');
  }
}

function handleMessage(syncManager, data) {
  try {
    data = JSON.parse(data);
    data = SyncMessage.parse(data);
  } catch(e) {
    return onError(syncManager, e);
  }

  if (data.is.request) {
    handleRequest(syncManager, data);
  } else if(data.is.response){
    handleResponse(syncManager, data);
  } else if(data.is.error){
    handleError(syncManager, data);
  } else {
    onError(syncManager, new Error('Cannot handle message'));
  }
}

module.exports = handleMessage;
