// rsync.js
// Implement rsync to sync between two Filer filesystems
// Portions used from Node.js Anchor module
// Copyright(c) 2011 Mihai Tomescu <matomesc@gmail.com>
// Copyright(c) 2011 Tolga Tezel <tolgatezel11@gmail.com>
// MIT Licensed
// https://github.com/ttezel/anchor

var Filer = require('./filer.js');
var Buffer = Filer.Buffer;
var Path = Filer.Path;
var fsUtils = require('./fs-utils.js');
var Errors = Filer.Errors;
var async = require('./async-lite.js');
var MD5 = require('MD5');
var rsync = {};
var constants = require('./constants.js');
var conflict = require('./conflict.js');
var ld_shim = require('./lodash-lite.js');

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
  options.checksum = 'checksum' in options ? options.checksum : true;
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

// Validate the parameters sent to each rsync method
function validateParams(fs, path) {
  if(!fs) {
    return new Errors.EINVAL('No filesystem provided');
  }

  if(!path) {
    return new Errors.EINVAL('Path must be specified');
  }

  return null;
}

// MD5 hashing for RSync
function md5sum(data) {
  return MD5(data).toString();
}

// Weak32 hashing for RSync based on Mark Adler's 32bit checksum algorithm
function calcWeak32(data, prev, start, end) {
  var a = 0;
  var b = 0;
  var sum = 0;
  var M = 1 << 16;
  var N = 65521;

  if (!prev) {
    var len = (start >= 0 && end >= 0) ? (end - start + 1) : data.length;
    var datai;
    for (var i = 0; i < len; i++) {
      datai = data[i];
      a += datai;
      b += ((len - i) * datai);
    }

    a %= N;
    b %= N;
  } else {
    var k = start;
    var l = end - 1;
    var prev_k = k - 1;
    var prev_l = l - 1;
    var prev_first = data[prev_k];
    var prev_last = data[prev_l];
    var curr_first = data[k];
    var curr_last = data[l];

    a = (prev.a - prev_first + curr_last) % N;
    b = (prev.b - (prev_l - prev_k + 1) * prev_first + a) % N;
  }
  return { a: a, b: b, sum: a + b * M };
}

// Weak16 hashing for RSync
function calcWeak16(data) {
  return 0xffff & (data >> 16 ^ data * 1009);
}

// RSync algorithm to create a hashtable from checksums
function createHashtable(checksums) {
  var hashtable = {};
  var len = checksums.length;
  var checksum;
  var weak16;

  for (var i = 0; i < len; i++) {
    checksum = checksums[i];
    weak16 = calcWeak16(checksum.weak);
    if (hashtable[weak16]) {
      hashtable[weak16].push(checksum);
    } else {
      hashtable[weak16] = [checksum];
    }
  }
  return hashtable;
}

// RSync algorithm to perform data rolling
function roll(data, checksums, chunkSize) {
  var results = [];
  var hashtable = createHashtable(checksums);
  var length = data.length;
  var start = 0;
  var end = chunkSize > length ? length : chunkSize;
  // Updated when a block matches
  var lastMatchedEnd = 0;
  // This gets updated every iteration with the previous weak 32bit hash
  var prevRollingWeak = null;
  var weak;
  var weak16;
  var match;
  var d;
  var len;
  var mightMatch;
  var chunk;
  var strong;
  var hashtable_weak16;
  var hashtable_weak16i;

  for (; end <= length; start++, end++) {
    weak = calcWeak32(data, prevRollingWeak, start, end);
    weak16 = calcWeak16(weak.sum);
    match = false;
    d = null;
    prevRollingWeak = weak;
    hashtable_weak16 = hashtable[weak16];

    if (hashtable_weak16) {
      len = hashtable_weak16.length;
      for (var i = 0; i < len; i++) {
        hashtable_weak16i = hashtable_weak16[i];
        if (hashtable_weak16i.weak === weak.sum) {
          mightMatch = hashtable_weak16i;
          chunk = data.slice(start, end);
          strong = md5sum(chunk);

          if (mightMatch.strong === strong) {
            match = mightMatch;
            break;
          }
        }
      }
    }
    if (match) {
      if(start < lastMatchedEnd) {
        d = data.slice(lastMatchedEnd - 1, end);
        results.push({
          data: d,
          index: match.index
        });
      } else if (start - lastMatchedEnd > 0) {
        d = data.slice(lastMatchedEnd, start);
        results.push({
          data: d,
          index: match.index
        });
      } else {
        results.push({
          index: match.index
        });
      }
      lastMatchedEnd = end;
    } else if (end === length) {
      // No match and last block
      d = data.slice(lastMatchedEnd);
      results.push({
        data: d
      });
    }
  }
  return results;
}

// RSync function to calculate checksums
function checksum (fs, path, size, callback) {
  var cache = {};

  fs.readFile(path, function (err, data) {
    if (!err) {
      // cache file
      cache[path] = data;
    } else if (err && err.code === 'ENOENT') {
      cache[path] = [];
    } else {
      return callback(err);
    }

    var length = cache[path].length;
    var incr = size;
    var start = 0;
    var end = incr > length ? length : incr;
    var blockIndex = 0;
    var result = [];
    var chunk;
    var weak;
    var strong;

    while (start < length) {
      chunk  = cache[path].slice(start, end);
      weak   = calcWeak32(chunk).sum;
      strong = md5sum(chunk);

      result.push({
        index: blockIndex,
        weak: weak,
        strong: strong
      });
      // update slice indices
      start += incr;
      end = (end + incr) > length ? length : end + incr;
      // update block index
      blockIndex++;
    }

    callback(null, result);
  });
}

function extractPathsFromDiffs(diffs) {
  function getPath(diff, index, array) {
    return diff.path;
  }

  return diffs.map(getPath);
}

// Generate the list of paths at the source file system
rsync.sourceList = function getSrcList(fs, path, options, callback) {
  callback = findCallback(callback, options);

  var paramError = validateParams(fs, path);

  if(paramError) {
    return callback(paramError);
  }

  options = configureOptions(options);

  var sourceList = [];

  fs.lstat(path, function(err, stats) {
    if(err) {
      return callback(err);
    }

    // File or Link
    if(!stats.isDirectory()) {
      // Make sure this isn't a conflicted copy before adding
      // (we don't send these to the server in a sync)
      conflict.isConflictedCopy(fs, path, function(err, conflicted) {
        if(err) {
          return callback(err);
        }

        if(!conflicted) {
          var node = {
            path: path,
            size: stats.size,
            type: stats.type,
            modified: stats.mtime
          };
          sourceList.push(node);
        }

        callback(null, sourceList);
      });

      return;
    }
    // Directory
    fs.readdir(path, function(err, entries) {
      if(err) {
        return callback(err);
      }

      function getSrcContents(_name, callback) {
        var name = Path.join(path, _name);

        fs.lstat(name, function(err, stats) {
          if(err) {
            return callback(err);
          }

          var node = {
            path: name,
            modified: stats.mtime,
            size: stats.size,
            type: stats.type
          };

          // Directory
          if(options.recursive && stats.isDirectory()) {
            getSrcList(fs, name, options, function(err, items) {
              if(err) {
                return callback(err);
              }

              sourceList.push(node);
              sourceList = sourceList.concat(items);
              callback();
            });
          }
          // File or Link
          else {
            // Make sure this isn't a conflicted copy before adding
            // (we don't send these to the server in a sync)
            conflict.isConflictedCopy(fs, name, function(err, conflicted) {
              if(err) {
                return callback(err);
              }

              if(!conflicted) {
                sourceList.push(node);
              }

              callback();
            });
          }
        });
      }

      async.eachSeries(entries, getSrcContents, function(err) {
        if(err) {
          return callback(err);
        }

        callback(null, sourceList);
      });
    });
  });
};

// Generate checksums for every node in a given destination path
rsync.checksums = function(fs, path, srcList, options, callback) {
  callback = findCallback(callback, options);

  var paramError = validateParams(fs, path);

  if(paramError) {
    return callback(paramError);
  }

  options = configureOptions(options);

  var nodeChecksums = [];

  function checksumsForDir(nodeChecksum, entry, callback) {
    nodeChecksum.checksums = [];
    nodeChecksums.push(nodeChecksum);
    callback();
  }

  function checksumsForFile(nodeChecksum, entry, callback) {
    if(!options.checksum || options.recursive) {
      fs.stat(entry.path, function(err, stat) {
        if(err && err.code !== 'ENOENT') {
          return callback(err);
        }

        // Add `identical` if the modified time and size of the existing file match
        if(stat && stat.mtime === entry.modified && stat.size === entry.size) {
          nodeChecksum.checksums = [];
          nodeChecksum.modified = entry.modified;
          nodeChecksum.identical = true;

          nodeChecksums.push(nodeChecksum);
          callback();
        } else {
          checksum(fs, entry.path, options.size, function(err, checksums) {
            if(err) {
              return callback(err);
            }

            nodeChecksum.checksums = checksums;
            nodeChecksum.modified = entry.modified;

            nodeChecksums.push(nodeChecksum);
            callback();
          });
        }
      });
    } else {
      checksum(fs, entry.path, options.size, function(err, checksums) {
        if(err) {
          return callback(err);
        }

        nodeChecksum.checksums = checksums;
        nodeChecksum.modified = entry.modified;

        nodeChecksums.push(nodeChecksum);
        callback();
      });
    }
  }

  function checksumsForLink(nodeChecksum, entry, callback) {
    nodeChecksum.link = true;

    if(!options.checksum || options.recursive) {
      fs.stat(entry.path, function(err, stat){
        if(err && err.code !== 'ENOENT') {
          return callback(err);
        }

        // Add `identical` if the modified time and size of the existing file match
        if(stat && stat.mtime === entry.modified && stat.size === entry.size) {
          nodeChecksum.identical = true;
        } else if((!err || err.code !== 'ENOENT') && !options.links) {
          return fs.readlink(entry.path, function(err, linkContents) {
            if(err) {
              return callback(err);
            }

            checksum(fs, linkContents, options.size, function(err, checksums) {
              if(err) {
                return callback(err);
              }

              nodeChecksum.checksums = checksums;
              nodeChecksums.push(nodeChecksum);
              callback();
            });
          });
        }

        nodeChecksums.push(nodeChecksum);
        callback();
      });
    } else {
      nodeChecksums.push(nodeChecksum);
      callback();
    }
  }

  function getNodeChecksums(entry, callback) {
    var nodeType = entry.type;
    var nodeChecksum = {path: entry.path, type: nodeType};

    // Create any parent directories that do not exist
    fs.Shell().mkdirp(Path.dirname(entry.path), function(err) {
      if(err && err.code !== 'EEXIST') {
        return callback(err);
      }

      // Directory
      if(nodeType === 'DIRECTORY') {
        checksumsForDir(nodeChecksum, entry, callback);
      }
      // File or Link
      else {
        if(nodeType === 'FILE' || !options.links) {
          checksumsForFile(nodeChecksum, entry, callback);
        } else if(nodeType === 'SYMLINK'){
          checksumsForLink(nodeChecksum, entry, callback);
        }
      }
    });
  }

  async.eachSeries(srcList, getNodeChecksums, function(err) {
    if(err) {
      callback(err);
    } else {
      callback(null, nodeChecksums);
    }
  });
};

// Generate diffs from the source based on destination checksums
rsync.diff = function(fs, path, checksums, options, callback) {
  callback = findCallback(callback, options);

  var paramError = validateParams(fs, path);

  if(paramError) {
    return callback(paramError);
  }

  options = configureOptions(options);

  if(options.checksum && !checksums) {
    return callback(new Errors.EINVAL('Checksums must be provided'));
  }

  var nodeDiffs = [];

  function getDiff(entry, callback) {
    var entryPath = entry.path;

    // Directory
    if(entry.type === 'DIRECTORY') {
      nodeDiffs.push({
        path: entryPath,
        type: entry.type
      });

      callback();
    }
    // Link
    else if (entry.link) {
      fs.readlink(entryPath, function(err, linkContents) {
        if(err) {
          return callback(err);
        }

        fs.lstat(entryPath, function(err, stats){
          var nodeDiff;

          if(err) {
            return callback(err);
          }

          nodeDiff = {
            link: linkContents,
            modified: stats.mtime,
            path: entryPath,
            type: entry.type
          };

          if(!options.links) {
            return fs.readFile(linkContents, function(err, data) {
              if(err) {
                return callback(err);
              }

              nodeDiff.diffs = roll(data, entry.checksums, options.size);
              nodeDiffs.push(nodeDiff);

              callback(null, nodeDiffs);
            });
          }

          nodeDiffs.push(nodeDiff);

          callback(null, nodeDiffs);
        });
      });
    }
    // File
    else {
      if(entry.identical) {
        nodeDiffs.push({
          diffs: [],
          modified: entry.modified,
          path: entryPath,
          type: entry.type
        });

        callback(null, nodeDiffs);
      } else {
        fs.readFile(entryPath, function (err, data) {
          if (err) {
            return callback(err);
          }

          nodeDiffs.push({
            diffs: roll(data, entry.checksums, options.size),
            modified: entry.modified,
            path: entryPath,
            type: entry.type
          });

          callback(null, nodeDiffs);
        });
      }
    }
  }

  fs.lstat(path, function(err, stat) {
    if(err) {
      return callback(err);
    }
    // Directory
    if(stat.isDirectory()) {
      async.eachSeries(checksums, getDiff, function(err) {
        if(err) {
          return callback(err);
        }

        callback(null, nodeDiffs);
      });
    }
    // File
    else if (stat.isFile() || !options.links) {
      if(checksums[0].identical) {
        nodeDiffs.push({
          diffs: [],
          modified: checksums[0].modified,
          path: checksums[0].path,
          type: checksums[0].type
        });

        return callback(null, nodeDiffs);
      }

      fs.readFile(path, function (err, data) {
        if (err) {
          return callback(err);
        }

        nodeDiffs.push({
          diffs: roll(data, checksums[0].checksums, options.size),
          modified: checksums[0].modified,
          path: checksums[0].path,
          type: checksums[0].type
        });

        callback(null, nodeDiffs);
      });
    }
    // Link
    else if (stat.isSymbolicLink()) {
      fs.readlink(path, function(err, linkContents) {
        if(err) {
          return callback(err);
        }

        fs.lstat(path, function(err, stats){
          var nodeDiff;

          if(err) {
            return callback(err);
          }

          nodeDiff = {
            link: linkContents,
            modified: stats.mtime,
            path: checksums[0].path,
            type: checksums[0].type
          };

          if(!options.links) {
            return fs.readFile(linkContents, function(err, data) {
              if(err) {
                return callback(err);
              }

              nodeDiff.diffs = roll(data, checksums[0].checksums, options.size);
              nodeDiffs.push(nodeDiff);

              callback(null, nodeDiffs);
            });
          }

          nodeDiffs.push(nodeDiff);

          callback(null, nodeDiffs);
        });
      });
    }
  });
};

// Path the destination filesystem by applying diffs
rsync.patch = function(fs, path, diff, options, callback) {
  callback = findCallback(callback, options);

  var paramError = validateParams(fs, path);
  var paths = {
    synced: [],
    failed: [],
    update: function(newPaths) {
      this.synced = this.synced.concat(newPaths.synced);
      this.failed = this.failed.concat(newPaths.failed);
    }
  };
  var pathsToSync = extractPathsFromDiffs(diff);

  if(paramError) {
    return callback(paramError, paths);
  }

  options = configureOptions(options);

  function handleError(err, callback) {
    // Determine the node paths for those that were not synced
    // by getting the difference between the paths that needed to
    // be synced and the paths that were synced
    var failedPaths = ld_shim.difference(pathsToSync, paths.synced);
    paths.failed = paths.failed.concat(failedPaths);
    callback(err, paths);
  }

  function syncEach(entry, callback) {
    var nodePath = entry.path;

    function patchFile() {
      fs.readFile(nodePath, function(err, data) {
        var raw;

        // Get slice of raw file from block's index
        function rawslice(index) {
          var start = index * options.size;
          var end = start + options.size > raw.length ? raw.length : start + options.size;

          return raw.slice(start, end);
        }

        if(err) {
          if(err.code !== 'ENOENT') {
            return handleError(err, callback);
          }

          raw = new Buffer(0);
        } else {
          raw = data;
        }

        var len = entry.diffs.length;
        var chunks = [];

        for(var i = 0; i < len; i++) {
          var chunk = entry.diffs[i];

          if(!chunk.data) {
            // Use slice of original file
            chunks.push(rawslice(chunk.index));
          } else {
            chunks.push(chunk.data);
            if(chunk.index) {
              chunks.push(rawslice(chunk.index));
            }
          }
        }

        // Before we alter the local file, make sure we don't
        // need a conflicted copy before proceeding.
        fsUtils.isPathUnsynced(fs, nodePath, function(err, unsynced) {
          if(err) {
            return handleError(err, callback);
          }

          function write() {
            var buf = Buffer.concat(chunks);
            fs.writeFile(nodePath, buf, function(err) {
              if(err) {
                return handleError(err, callback);
              }

              if(!options.time) {
                paths.synced.push(nodePath);
                return callback(null, paths);
              }

              // Updates the modified time of the node
              fs.utimes(nodePath, entry.modified, entry.modified, function(err) {
                if(err) {
                  return handleError(err, callback);
                }

                paths.synced.push(nodePath);
                callback(null, paths);
              });
            });
          }

          if(unsynced) {
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

                write();
              });
            });
          } else {
            write();
          }
        });
      });
    }

    // Directory
    if(entry.type === 'DIRECTORY') {
      return fs.mkdir(nodePath, function(err) {
        if(err && err.code !== 'EEXIST') {
          return handleError(err, callback);
        }

        paths.synced.push(nodePath);
        callback(null, paths);
      });
    }

    // Link
    if (entry.type === 'SYMLINK') {
      if(options.links) {
        return fs.symlink(entry.link, nodePath, function(err){
          if(err) {
            return handleError(err, callback);
          }

          paths.synced.push(nodePath);
          callback(null, paths);
        });
      }

      return patchFile();
    }

    // File
    if(!entry.diffs.length) {
      paths.synced.push(nodePath);
      return callback(null, paths);
    }

    patchFile();
  }

  // Remove deleted nodes in the destination path
  function removeDeletedNodes(path, diff, callback) {
    callback = findCallback(callback, diff);

    // Remove the nodes in the patched directory that are no longer
    // present in the source. The only exception to this is any file
    // locally that hasn't been synced to the server yet (i.e.,
    // we don't want to delete things in a downstream sync because they
    // don't exist upstream yet, since an upstream sync will add them).
    function removeNodesInDir(dirContents, callback) {
      function maybeUnlink(nodePath, callback) {
        var deletePath = Path.join(path, nodePath);

        if(pathsToSync.indexOf(deletePath) !== -1) {
          return callback(null, paths);
        }

        // Make sure this file isn't unsynced before deleting
        fsUtils.isPathUnsynced(fs, deletePath, function(err, unsynced) {
          if(err) {
            return handleError(err, callback);
          }

          if(unsynced) {
            // Don't delete
            return callback(null, paths);
          }

          paths.synced.push(deletePath);
          fs.unlink(deletePath, callback);
        });
      }

      async.eachSeries(dirContents, maybeUnlink, function(err) {
        if(err) {
          return callback(err, paths);
        }

        callback(null, paths);
      });
    }

    function processDir(subPath, callback) {
      subPath = Path.join(path, subPath);

      fs.lstat(subPath, function(err, stats) {
        if(err) {
          return handleError(err, callback);
        }

        if(!stats.isDirectory()) {
          return callback(null, paths);
        }

        removeDeletedNodes(subPath, diff, callback);
      });
    }

    fs.lstat(path, function(err, stats) {
      if(err) {
        return callback(err);
      }

      if(!stats.isDirectory()) {
        return callback(null, paths);
      }

      fs.readdir(path, function(err, contents) {
        if(err) {
          if(err.code === 'ENOTDIR') {
            return callback(null, paths);
          }

          return handleError(err, callback);
        }

        async.eachSeries(contents, processDir, function(err, paths) {
          if(err) {
            return handleError(err, callback);
          }

          removeNodesInDir(contents, function(err, paths) {
            if(err) {
              return handleError(err, callback);
            }

            callback(null, paths);
          });
        });
      });
    });
  }

  if(diff && diff.length) {
    async.eachSeries(diff, syncEach, function(err) {
      if(err) {
        callback(err, paths);
      } else {
        removeDeletedNodes(path, diff, callback);
      }
    });
  } else {
    fs.Shell().mkdirp(path, function(err) {
      if(err && err !== 'EEXIST') {
        callback(err, paths);
      } else {
        removeDeletedNodes(path, callback);
      }
    });
  }
};

// Generate checksums for an array of paths to be used for comparison
rsync.pathChecksums = function(fs, paths, chunkSize, callback) {
  var paramError = validateParams(fs, paths);
  var checksums = [];

  if(!chunkSize || typeof callback !== 'function') {
    return callback(new Errors.EINVAL('Insufficient data provided'));
  }

  if(paramError) {
    return callback(paramError);
  }

  function generateChecksum(path, callback) {
    var entry = {path: path};

    fs.lstat(path, function(err, stat) {
      if(err) {
        if(err.code !== 'ENOENT') {
          return callback(err);
        }

        // Node does not exist
        entry.checksum = [];
        checksums.push(entry);
        return callback();
      }

      // Use contents of directory instead of checksums
      if(stat.isDirectory()) {
        return fs.readdir(path, function(err, nodeList) {
          if(err) {
            return callback(err);
          }

          entry.contents = nodeList;
          checksums.push(entry);
          callback();
        });
      }

      // Calculate checksums for file or symbolic links
      checksum(fs, path, chunkSize, function(err, chksum) {
        if(err) {
          return callback(err);
        }

        entry.checksum = chksum;
        checksums.push(entry);
        callback();
      });
    });
  }

  async.eachSeries(paths, generateChecksum, function(err) {
    if(err) {
      return callback(err);
    }

    callback(null, checksums);
  });
};

// Compare two filesystem contents by comparing checksums
rsync.compareContents = function(fs, checksums, chunkSize, callback) {
  var EDIFF = 'DIFF';
  var paramError = validateParams(fs, checksums);

  if(!chunkSize || typeof callback !== 'function') {
    return callback(new Errors.EINVAL('Insufficient data provided'));
  }

  if(paramError) {
    return callback(paramError);
  }

  // Check if two checksum arrays are equal
  function isEqual(checksum1, checksum2) {
    var comparisonLength = checksum2.length;
    var checksum1i, checksum2i;

    if(checksum1.length !== comparisonLength) {
      return false;
    }

    // Sort the checksum objects in each array by the 'index' property
    checksum1 = ld_shim.map(ld_shim.sortBy(checksum1, 'index'), ld_shim.values);
    checksum2 = ld_shim.map(ld_shim.sortBy(checksum2, 'index'), ld_shim.values);

    // Compare each object's checksums
    for(var i = 0; i < comparisonLength; i++) {
      checksum1i = checksum1[i];
      checksum2i = checksum2[i];

      if(checksum1i[1] !== checksum2i[1] ||
        checksum1i[2] !== checksum2i[2]) {
        return false;
      }
    }

    return true;
  }

  function compare(entry, callback) {
    var path = entry.path;

    fs.lstat(path, function(err, stat) {
      if(err) {
        if(err.code !== 'ENOENT') {
          return callback(err);
        }

        // Checksums for a non-existent path are empty
        if(entry.checksum && !entry.checksum.length) {
          return callback();
        }

        return callback(EDIFF);
      }

      // Directory comparison of contents
      if(stat.isDirectory()) {
        return fs.readdir(path, function(err, nodeList) {
          if(err) {
            return callback(err);
          }

          if(!entry.contents || ld_shim.difference(entry.contents, nodeList).length) {
            return callback(EDIFF);
          }

          callback();
        });
      }

      if(!entry.checksum) {
        return callback(EDIFF);
      }

      // Compare checksums for two files/symbolic links
      checksum(fs, path, chunkSize, function(err, checksum) {
        if(err) {
          return callback(err);
        }

        if(!isEqual(checksum, entry.checksum)) {
          return callback(EDIFF);
        }

        callback();
      });
    });
  }

  async.eachSeries(checksums, compare, function(err) {
    if(err && err !== EDIFF) {
      return callback(err, false);
    }

    if(err === EDIFF) {
      return callback(null, false);
    }

    callback(null, true);
  });
};

module.exports = rsync;
