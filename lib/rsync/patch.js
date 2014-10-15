var fsUtils = require('../fs-utils');
var Filer = require('../filer');
var Buffer = Filer.Buffer;
var Path = Filer.Path;
var async = require('../async-lite');
var conflict = require('../conflict');
var rsyncUtils = require('./rsync-utils');

function extractPathsFromDiffs(diffs) {
  function getPath(diff) {
    return diff.path;
  }

  return diffs.map(getPath);
}

// This function has been taken from lodash
// Licensed under the MIT license
// https://github.com/lodash/lodash
function difference(arr, farr) {
  return arr.filter(function(v) {
    return farr.indexOf(v) === -1;
  });
}

// Path the destination filesystem by applying diffs
module.exports = function patch(fs, path, diffList, options, callback) {
  callback = rsyncUtils.findCallback(callback, options);

  var paths = {
    synced: [],
    failed: [],
    needsUpstream: []
  };
  var pathsToSync = extractPathsFromDiffs(diffList);

  var paramError = rsyncUtils.validateParams(fs, path);
  if(paramError) {
    return callback(paramError);
  }

  options = rsyncUtils.configureOptions(options);

  // Taken from 

  function handleError(err, callback) {
    // Determine the node paths for those that were not synced
    // by getting the difference between the paths that needed to
    // be synced and the paths that were synced
    var failedPaths = difference(pathsToSync, paths.synced);
    paths.failed = paths.failed.concat(failedPaths);

    callback(err, paths);
  }

  // Remove the nodes in the patched directory that are no longer
  // present in the source. The only exception to this is any file
  // locally that hasn't been synced to the server yet (i.e.,
  // we don't want to delete things in a downstream sync because they
  // don't exist upstream yet, since an upstream sync will add them).
  function removeDeletedNodes(path, callback) {

    function maybeUnlink(pathToDelete, callback) {
      if(pathsToSync.indexOf(pathToDelete) !== -1) {
        return callback();
      }

      // Make sure this file isn't unsynced before deleting
      fsUtils.isPathUnsynced(fs, pathToDelete, function(err, unsynced) {
        if(err) {
          return handleError(err, callback);
        }

        if(unsynced) {
          // Don't delete
          return callback();
        }

        // Make sure this file isn't conflicted before deleting.
        // Conflicted copies will not be touched by rsync
        conflict.isConflictedCopy(fs, pathToDelete, function(err, conflicted) {
          if(err) {
            return handleError(err, callback);
          }

          if(conflicted) {
            // Don't delete
            return callback();
          }

          paths.synced.push(pathToDelete);
          fs.unlink(pathToDelete, callback);
        });
      });
    }

    function processRemoval(subPath, callback) {
      var nodePath = Path.join(path, subPath);

      fs.lstat(nodePath, function(err, stats) {
        if(err) {
          return handleError(err, callback);
        }

        if(!stats.isDirectory()) {
          return maybeUnlink(nodePath, callback);
        }

        removeDeletedNodes(nodePath, callback);
      });
    }

    function removeDeletedNodesInDir(dirContents) {
      async.eachSeries(dirContents, processRemoval, function(err) {
        if(err) {
          return handleError(err, callback);
        }

        maybeUnlink(path, function(err) {
          if(err) {
            return handleError(err, callback);
          }

          callback(null, paths); 
        });
      });
    }

    fs.lstat(path, function(err, stats) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      // Bail if the path is a file/link or 
      // the path does not exist, i.e. nothing was patched
      if((err && err.code === 'ENOENT') || !stats.isDirectory()) {
        return callback(null, paths);
      }

      fs.readdir(path, function(err, dirContents) {
        if(err) {
          return handleError(err, callback);
        }

        removeDeletedNodesInDir(dirContents);
      });
    });
  }

  function maybeGenerateConflicted(nodePath, callback) {
    // If the file has not been synced upstream
    // and needs to be patched, create a conflicted copy
    fsUtils.isPathUnsynced(fs, nodePath, function(err, unsynced) {
      if(err) {
        return handleError(err, callback);
      }

      // Generate a conflicted copy only for an unsynced file
      if(!unsynced) {
        return callback();
      }

      conflict.makeConflictedCopy(fs, nodePath, function(err) {
        if(err) {
          return handleError(err, callback);
        }

        // Because we'll overwrite the file with upstream changes,
        // remove the unsynced attribute (local changes are in
        // the conflicted copy now).
        fsUtils.removeUnsynced(fs, nodePath, function(err) {
          if(err) {
            return handleError(err, callback);
          }

          callback();
        });
      });
    });
  }

  function patchFile(diffNode, callback) {
    var diffLength = diffNode.diffs ? diffNode.diffs.length : 0;
    var filePath = diffNode.path;

    // Compare the version of the file when it was last
    // synced with the version of the diffNode by comparing
    // checksums and modified times.
    // If they match, the file is not patched and needs to
    // be upstreamed
    function compareVersions(data) {
      fs.lstat(filePath, function(err, stats) {
        if(err) {
          return handleError(err, callback);
        }

        // If the file was modified before the
        // diffNode's modified time, the file is outdated
        // and needs to be patched
        if(stats.mtime <= diffNode.modified) {
          return applyPatch(getPatchedData(data));
        }

        fsUtils.getChecksum(fs, filePath, function(err, checksum) {
          if(err) {
            return handleError(err, callback);
          }

          // If the last synced checksum matches the
          // diffNode's checksum, ignore the patch
          // because it is a newer version than whats on
          // the server
          if(checksum === diffNode.checksum) {
            paths.needsUpstream.push(filePath);
            return callback(null, paths);
          }

          applyPatch(getPatchedData(data));
        });
      });
    }

    function updateModifiedTime() {
      fs.utimes(filePath, diffNode.modified, diffNode.modified, function(err) {
        if(err) {
          return handleError(err, callback);
        }

        paths.synced.push(filePath);
        callback(null, paths);
      });
    }

    function applyPatch(data) {
      // Before we alter the local file, make sure we don't
      // need a conflicted copy before proceeding.
      maybeGenerateConflicted(filePath, function(err) {
        if(err) {
          return handleError(err, callback);
        }

        fs.writeFile(filePath, data, function(err) {
          if(err) {
            return handleError(err, callback);
          }

          if(options.time) {
            return updateModifiedTime();
          }

          paths.synced.push(filePath);
          callback(null, paths);
        });
      });
    }

    function getPatchedData(rawData) {
      var blocks = [];
      var block, blockData;

      function getRawFileBlock(offsetIndex) {
        var start = offsetIndex * options.size;
        var end = start + options.size;
        end = end > rawData.length ? rawData.length : end;

        return rawData.slice(start, end);
      }

      // Loop through the diffs and construct a buffer representing
      // the file using a block of data from either the original
      // file itself or from the diff depending on which position
      // the diff needs to be inserted at
      for(var i = 0; i < diffLength; i++) {
        block = diffNode.diffs[i];
        blockData = block.data || getRawFileBlock(block.index);

        blocks.push(blockData);

        if(block.data && block.index) {
          blocks.push(getRawFileBlock(block.index));
        }
      }

      return Buffer.concat(blocks);
    }

    // Nothing to patch
    if(!diffLength) {
      paths.synced.push(filePath);
      return callback(null, paths);
    }

    fs.readFile(filePath, function(err, data) {
      if(err) {
        if(err.code !== 'ENOENT') {
          return handleError(err, callback);
        }

        // Patch a non-existent file i.e. create it
        return applyPatch(getPatchedData(new Buffer(0)));
      }

      // If version comparing is not enabled, apply
      // the patch directly
      if(!options.versions) {
        return applyPatch(getPatchedData(data));
      }

      // Check the last synced checksum with
      // the given checksum and don't patch if they
      // match
      compareVersions(data);
    });
  }

  function patchLink(diffNode, callback) {
    var linkPath = diffNode.path;

    // Patch the symbolic link as a file
    if(!options.links) {
      return patchFile(diffNode, callback);
    }

    fs.symlink(diffNode.link, linkPath, function(err){
      if(err) {
        return handleError(err, callback);
      }

      paths.synced.push(linkPath);
      callback(null, paths);
    });
  }

  function patchDir(diffNode, callback) {
    var dirPath = diffNode.path;

    fs.mkdir(dirPath, function(err) {
      if(err && err.code !== 'EEXIST') {
        return handleError(err, callback);
      }

      paths.synced.push(dirPath);
      callback(null, paths);
    });
  }

  function patchNode(diffNode, callback) {
    // Directory
    if(diffNode.type === 'DIRECTORY') {
      return patchDir(diffNode, callback);
    }

    // Symbolic link
    if(diffNode.type === 'SYMLINK') {
      return patchLink(diffNode, callback);
    }

    // File
    patchFile(diffNode, callback);
  }

  function applyDiffs(diffNode, callback) {
    createParentDirectories(diffNode.path, function(err) {
      if(err) {
        return callback(err);
      }

      patchNode(diffNode, callback);
    });
  }

  function processDiffList() {
    async.eachSeries(diffList, applyDiffs, function(err) {
      if(err) {
        return handleError(err, callback);
      }

      removeDeletedNodes(path, callback);
    });
  }

  // Create any parent directories that do not exist
  function createParentDirectories(path, callback) {
    fs.Shell().mkdirp(Path.dirname(path), function(err) {
      if(err && err.code !== 'EEXIST') {
        return callback(err);
      }

      callback();
    });
  }

  if(diffList && diffList.length) {
    return processDiffList();
  }

  createParentDirectories(path, function(err) {
    if(err && err !== 'EEXIST') {
      return callback(err, paths);
    }

    removeDeletedNodes(path, callback);
  });
};
