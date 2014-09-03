/* rsync.js
 * Implement rsync to sync between two Filer filesystems
 * Portions used from Node.js Anchor module
 * Copyright(c) 2011 Mihai Tomescu <matomesc@gmail.com>
 * Copyright(c) 2011 Tolga Tezel <tolgatezel11@gmail.com>
 * MIT Licensed
 * https://github.com/ttezel/anchor
*/

var Filer = require('./filer.js');
var Buffer = Filer.Buffer;
var Path = Filer.Path;
var fsUtils = require('./fs-utils.js');
var Errors = Filer.Errors;
var async = require('./async-lite.js');
var MD5 = require('MD5');
var rsync = {};
var conflict = require('./conflict.js');
var ld_shim = require('./lodash-lite.js');
var rsyncUtils = require('./rsync-utils.js');

// Rsync Options that can be passed are:
// size       -   the size of each chunk of data in bytes that should be checksumed
// checksum   -   true: always calculate checksums [default]
//                false: ignore checksums for identical files
// recursive  -   true: sync each contained node in the path provided
//                false: only sync the node for the path provided [default]
// time       -   true: sync modified times of source/destination files
//                false: do not change modified times of destination files [default]
// links      -   true: sync symbolic links as links in destination
//                false: sync symbolic links as the files they link to in destination [default]
function configureOptions(options) {
  if(!options || typeof options === 'function') {
    options = {};
  }

  options.size = options.size || 512;
  options.checksum = options.checksum !== false;
  options.recursive = options.recursive || false;
  options.time = options.time || false;
  options.links = options.links || false;

  return options;
}

// Set the callback in case options are not provided
function findCallback(callback, options) {
  if(!callback && typeof options === 'function') {
    callback = options;
  }

  return callback;
}

function extractPathsFromDiffs(diffs) {
  function getPath(diff) {
    return diff.path;
  }

  return diffs.map(getPath);
}

// Generate the list of paths at the source file system
rsync.sourceList = function(fs, path, options, callback) {
  callback = findCallback(callback, options);

  if(!rsyncUtils.validateParams(fs, path, callback)) return;

  options = configureOptions(options);

  var sourceList = [];

  function SourceNode(path, stats) {
    this.path = path;
    this.modified = stats.mtime;
    this.size = stats.size;
    this.type = stats.type; 
  }

  // Make sure this isn't a conflicted copy before adding
  // (we don't send these to the server in a sync)
  function addNonConflictedCopyToSrcList(sourceNode, callback) {
    conflict.isConflictedCopy(fs, sourceNode.path, function(err, conflicted) {
      if(err) {
        return callback(err);
      }

      if(!conflicted) {
        sourceList.push(sourceNode);
      }

      callback(null, sourceList);
    });
  }

  function getSrcListForDir(stats) {
    fs.readdir(path, function(err, entries) {
      if(err) {
        return callback(err);
      }

      function processDirContents(contentPath, callback) {
        var sourceNodePath = Path.join(path, contentPath);

        fs.lstat(sourceNodePath, function(err, stats) {
          if(err) {
            return callback(err);
          }

          var sourceNode = new SourceNode(sourceNodePath, stats);

          // File or Link or Non-recursive directory
          if(!options.recursive || !stats.isDirectory()) {
            return addNonConflictedCopyToSrcList(sourceNode, callback);
          }

          // Directory recursively
          rsync.sourceList(fs, sourceNodePath, options, function(err, items) {
            if(err) {
              return callback(err);
            }

            sourceList = sourceList.concat(items);
            
            callback();
          });
        });
      }

      // Add the directory to the sourceList
      sourceList.push(new SourceNode(path, stats));

      async.eachSeries(entries, processDirContents, function(err) {
        if(err) {
          return callback(err);
        }

        callback(null, sourceList);
      });
    });
  }

  function getSrcListForFileOrLink(stats) {
    var sourceNode = new SourceNode(path, stats);
    
    addNonConflictedCopyToSrcList(sourceNode, callback);
  }

  function getSrcListForPath(path) {
    fs.lstat(path, function(err, stats) {
      if(err) {
        return callback(err);
      }

      // File or Link
      if(!stats.isDirectory()) {
        return getSrcListForFileOrLink(stats);
      }

      // Directory
      getSrcListForDir(stats);
    });
  }

  getSrcListForPath(path);
};

// Generate checksums for every source node in a given destination path
rsync.checksums = function(fs, path, srcList, options, callback) {
  callback = findCallback(callback, options);

  if(!rsyncUtils.validateParams(fs, path, callback)) return;

  options = configureOptions(options);

  var checksumList = [];

  function ChecksumNode(path, type) {
    this.path = path;
    this.type = type;
  }

  function checksumsForFile(checksumNode, sourceNode, callback) {

    function generateChecksumsForFile() {
      rsyncUtils.checksum(fs, sourceNode.path, options.size, function(err, checksums) {
        if(err) {
          return callback(err);
        }

        checksumNode.checksums = checksums;
        checksumNode.modified = sourceNode.modified;
        checksumList.push(checksumNode);
        
        callback();
      });
    }

    // Checksums are always calculated even for identical files
    // if and only if checksums are turned on and rsync is not
    // implemented recursively
    if(options.checksum && !options.recursive) {
      return generateChecksumsForFile();
    }

    // Skip identical files if checksums are turned off or
    // if rsync is performed recursively
    fs.stat(sourceNode.path, function(err, stat) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      // Add the 'identical' flag if the modified time and size
      // of the existing file match
      if(stat && stat.mtime === sourceNode.modified && stat.size === sourceNode.size) {
        checksumNode.checksums = [];
        checksumNode.modified = sourceNode.modified;
        checksumNode.identical = true;
        checksumList.push(checksumNode);
        
        return callback();
      }

      generateChecksumsForFile();
    });
  }

  function checksumsForLink(checksumNode, sourceNode, callback) {

    function generateChecksumsForLink() {
      fs.readlink(sourceNode.path, function(err, linkContents) {
        if(err) {
          return callback(err);
        }

        rsyncUtils.checksum(fs, linkContents, options.size, function(err, checksums) {
          if(err) {
            return callback(err);
          }

          checksumNode.checksums = checksums;
          checksumList.push(checksumNode);
          
          callback();
        });
      });
    }

    // Checksums are always calculated even for identical links
    // if and only if checksums are turned on and rsync is not
    // implemented recursively
    if(options.checksum && !options.recursive) {
      checksumList.push(checksumNode);
      
      return callback();
    }

    // Skip identical links if checksums are turned off or
    // if rsync is performed recursively
    fs.stat(sourceNode.path, function(err, stat) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      // Add `identical` if the modified time and size of the existing file match
      if(stat && stat.mtime === sourceNode.modified && stat.size === sourceNode.size) {
        checksumNode.identical = true;
        checksumList.push(checksumNode);
        
        return callback();
      } 

      // Link does not exist i.e. no checksums
      if(err && err.code === 'ENOENT') {
        checksumList.push(checksumNode);
        
        return callback();
      }

      // Link exists and is not identical to the source link
      generateChecksumsForLink();
    });
  }

  function checksumsForDir(checksumNode, callback) {
    checksumNode.checksums = [];
    checksumList.push(checksumNode);

    callback();
  }

  function getChecksumsForSourceNode(sourceNode, callback) {
    var sourceNodeType = sourceNode.type;
    var checksumNode = new ChecksumNode(sourceNode.path, sourceNodeType);

    // Directory
    if(sourceNodeType === 'DIRECTORY') {
      return checksumsForDir(checksumNode, callback);
    }

    // Link
    if(sourceNodeType === 'SYMLINK' && options.link){
      checksumNode.link = true;
      
      return checksumsForLink(checksumNode, sourceNode, callback);
    }

    // File or Links treated as files
    checksumsForFile(checksumNode, sourceNode, callback);
  }

  async.eachSeries(srcList, getChecksumsForSourceNode, function(err) {
    if(err) {
      callback(err);
    } else {
      callback(null, checksumList);
    }
  });
};

// Generate diffs from the source based on destination checksums
rsync.diff = function(fs, path, checksumList, options, callback) {
  callback = findCallback(callback, options);

  if(!rsyncUtils.validateParams(fs, path, callback)) return;

  options = configureOptions(options);

  if(options.checksum && !checksumList) {
    return callback(new Errors.EINVAL('Checksums must be provided'));
  }

  var diffList = [];

  function DiffNode(path, type, modifiedTime, diffs) {
    this.path = path;
    this.type = type;
    this.diffs = diffs;
    this.modified = modifiedTime;
  }

  function diffsForLink(checksumNode, callback) {
    var checksumNodePath = checksumNode.path;
    var diffNode = new DiffNode(checksumNodePath, checksumNode.type, checksumNode.modified);

    fs.readlink(checksumNodePath, function(err, linkContents) {
      if(err) {
        return callback(err);
      }

      diffNode.link = linkContents;

      // If links are enabled, contents of the node pointed
      // to by the link are ignored
      if(options.links) {
        diffList.push(diffNode);

        return callback(null, diffList);
      }

      // If links are disabled, diffs are generated for
      // the node pointed to by the link
      fs.readFile(linkContents, function(err, data) {
        if(err) {
          return callback(err);
        }

        diffNode.diffs = rsyncUtils.rollData(data, checksumNode.checksums, options.size);
        diffList.push(diffNode);

        callback(null, diffList);
      });
    });
  }

  function diffsForFile(checksumNode, callback) {
    var checksumNodePath = checksumNode.path;
    var diffNode = new DiffNode(checksumNodePath, checksumNode.type, checksumNode.modified);

    // Identical files have empty diffs
    if(checksumNode.identical) {
      diffNode.diffs = [];
      diffList.push(diffNode);

      return callback(null, diffList);
    }

    fs.readFile(checksumNodePath, function(err, data) {
      if (err) {
        return callback(err);
      }

      diffNode.diffs = rsyncUtils.rollData(data, checksumNode.checksums, options.size);
      diffList.push(diffNode);

      callback(null, diffList);
    });
  }

  function diffsForDir() {

    function processDirContents(checksumNode, callback) {
      var checksumNodePath = checksumNode.path;
      var diffNode = new DiffNode(checksumNodePath, checksumNode.type);

      // Directory
      if(checksumNode.type === 'DIRECTORY') {
        diffNode.diffs = [];
        diffList.push(diffNode);

        return callback();
      }

      // Link
      if (checksumNode.link) {
        return diffsForLink(checksumNode, callback);
      }

      // File
      diffsForFile(checksumNode, callback);
    }

    async.eachSeries(checksumList, processDirContents, function(err) {
      if(err) {
        return callback(err);
      }

      callback(null, diffList);
    });
  }

  fs.lstat(path, function(err, stat) {
    if(err) {
      return callback(err);
    }

    // Directory
    if(stat.isDirectory()) {
      return diffsForDir();
    }

    // File
    if(stat.isFile() || !options.links) {
      return diffsForFile(checksumList[0], callback);
    }

    // Link
    diffsForLink(checksumList[0], callback);
  });
};

// Path the destination filesystem by applying diffs
rsync.patch = function(fs, path, diffList, options, callback) {
  callback = findCallback(callback, options);

  var paths = {
    synced: [],
    failed: [],
  };
  var pathsToSync = extractPathsFromDiffs(diffList);

  if(!rsyncUtils.validateParams(fs, path, callback)) return;

  options = configureOptions(options);

  function handleError(err, callback) {
    // Determine the node paths for those that were not synced
    // by getting the difference between the paths that needed to
    // be synced and the paths that were synced
    var failedPaths = ld_shim.difference(pathsToSync, paths.synced);
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

        paths.synced.push(pathToDelete);
        fs.unlink(pathToDelete, callback);
      });
    }

    function processRemoval(subPath, callback) {
      subPath = Path.join(path, subPath);

      fs.lstat(subPath, function(err, stats) {
        if(err) {
          return handleError(err, callback);
        }

        if(!stats.isDirectory()) {
          return maybeUnlink(subPath, callback);
        }

        removeDeletedNodes(subPath, callback);
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
      if(err) {
        return callback(err);
      }

      if(!stats.isDirectory()) {
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

  function resolveConflicted(nodePath, callback) {
    fsUtils.isPathUnsynced(fs, nodePath, function(err, unsynced) {
      if(err) {
        return handleError(err, callback);
      }

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
    var diffLength = diffNode.diffs.length;
    var filePath = diffNode.path;

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
      resolveConflicted(filePath, function(err) {
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
      var rawData = new Buffer(0);

      if(err && err.code !== 'ENOENT') {
        return handleError(err, callback);
      }

      if(data) {
        rawData = data;
      }

      applyPatch(getPatchedData(rawData));
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

module.exports = rsync;
