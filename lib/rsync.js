// rsync.js
// Implement rsync to sync between two Filer filesystems
// Portions used from Node.js Anchor module
// Copyright(c) 2011 Mihai Tomescu <matomesc@gmail.com>
// Copyright(c) 2011 Tolga Tezel <tolgatezel11@gmail.com>
// MIT Licensed
// https://github.com/ttezel/anchor

var Filer = require('./filer.js'),
    Buffer = Filer.Buffer,
    Path = Filer.Path,
    Errors = Filer.Errors,
    CryptoJS = require('crypto-js'),
    async = require('async'),
    _ = require('lodash'),
    MD5 = require('MD5'),
    rsync = {};

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
  if(!fs || !(fs instanceof Filer.FileSystem)) {
    return new Errors.EINVAL('No filesystem provided');
  }

  if(!path) {
    return new Errors.EINVAL('Path must be specified');
  }

  return null;
}

// Get the 'directory' path from the given path for an entry
// /dir/file.txt returns /dir
// /dir/folder returns /dir/folder
function getDirPath(path, entry) {
  if(Path.basename(path) === entry) {
   return Path.dirname(path);
  }
  return path;
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
      b += ((len - i + 1) * datai);
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
function checksum (path, options, callback) {
  var cache = {};

  this.readFile(path, function (err, data) {
    if (!err) {
      // cache file
      cache[path] = data;
    } else if (err && err.code === 'ENOENT') {
      cache[path] = [];
    } else {
      return callback(err);
    }

    var length = cache[path].length;
    var incr = options.size;
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
      var node = {
        path: Path.basename(path),
        size: stats.size,
        type: stats.type,
        modified: stats.mtime
      };

      sourceList.push(node);
      return callback(null, sourceList);
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
            path: Path.basename(name),
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

              node.contents = items;

              sourceList.push(node);
              callback();
            });
          }
          // File or Link
          else {
            sourceList.push(node);
            callback();
          }
        });
      }

      async.each(entries, getSrcContents, function(err) {
        callback(err, sourceList);
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
    var dir = Path.join(path, entry.path);

    // Create the directory if it does not exist
    fs.mkdir(dir, function(err) {
      if(err && err.code !== 'EEXIST') {
        return callback(err);
      }

      rsync.checksums(fs, dir, entry.contents, options, function(err, dirChecksums) {
        if(err) {
          return callback(err);
        }

        // For empty directories, force an empty array
        nodeChecksum.contents = dirChecksums || [];

        nodeChecksums.push(nodeChecksum);
        callback();
      });
    });
  }

  function checksumsForFile(nodeChecksum, entry, dirPath, absPath, callback) {
    if(!options.checksum || options.recursive) {
      fs.stat(absPath, function(err, stat) {
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
          checksum.call(fs, absPath, options, function(err, checksums) {
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
      checksum.call(fs, absPath, options, function(err, checksums) {
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

  function checksumsForLink(nodeChecksum, entry, dirPath, absPath, callback) {
    nodeChecksum.link = true;

    if(!options.checksum || options.recursive) {
      fs.stat(absPath, function(err, stat){
        if(err && err.code !== 'ENOENT') {
          return callback(err);
        }

        // Add `identical` if the modified time and size of the existing file match
        if(stat && stat.mtime === entry.modified && stat.size === entry.size) {
          nodeChecksum.identical = true;
        }

        nodeChecksums.push(nodeChecksum);
        callback();
      });
    } else {
      nodeChecksums.push(nodeChecksum);
      callback();
    }
  }

  function getDirChecksums(entry, callback) {
    var nodeChecksum = { path: entry.path };

    // Directory
    if(options.recursive && entry.type === 'DIRECTORY') {
      checksumsForDir(nodeChecksum, entry, callback);
    }
    // File or Link
    else {
      var dirPath = getDirPath(path, entry.path);
      var absPath = Path.join(dirPath, entry.path);

      // Create any parent directories that do not exist
      fs.mkdir(dirPath, function(err) {
        if(err && err.code !== 'EEXIST') {
          return callback(err);
        }

        if(entry.type === 'FILE' || !options.links) {
          checksumsForFile(nodeChecksum, entry, dirPath, absPath, callback);
        } else if(entry.type === 'SYMLINK'){
          checksumsForLink(nodeChecksum, entry, dirPath, absPath, callback);
        }
      });
    }
  }

  async.each(srcList, getDirChecksums, function(err) {
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
    var entryPath = Path.join(path, entry.path);

    // Directory
    if(entry.contents) {
      rsync.diff(fs, entryPath, entry.contents, options, function(err, diffs) {
        if(err) {
          return callback(err);
        }

        nodeDiffs.push({
          path: entry.path,
          contents: diffs
        });

        callback();
      });
    }
    // Link
    else if (entry.link) {
      fs.readlink(entryPath, function(err, linkContents) {
        if(err) {
          return callback(err);
        }

        fs.lstat(entryPath, function(err, stats){
          if(err) {
            return callback(err);
          }

          nodeDiffs.push({
            link: linkContents,
            modified: stats.mtime,
            path: entry.path
          });

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
          path: entry.path,
          // Indicates that since the checksum was identical to the source, no diffs should be applied
          identical: true
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
            path: entry.path
          });

          callback(null, nodeDiffs);
        });
      }
    }
  }

  fs.lstat(path, function(err, stat) {
    // Directory
    if(stat.isDirectory()) {
      async.each(checksums, getDiff, function(err) {
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
          identical: true
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
          path: checksums[0].path
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
          if(err) {
            return callback(err);
          }

          nodeDiffs.push({
            link: linkContents,
            modified: stats.mtime,
            path: checksums[0].path
          });

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

  if(paramError) {
    return callback(paramError);
  }

  options = configureOptions(options);

  // Remove the nodes in the patched directory that are no longer present in the source
  function removeNodes(path, entryDiff, callback) {
    if(typeof entryDiff === 'function') {
      callback = entryDiff;
      entryDiff = null;
    }

    fs.readdir(path, function(err, destContents) {
      if(err) {
        return callback(err);
      }

      var deletedNodes = destContents;

      if(entryDiff) {
        var srcContents = entryDiff.map(function(element) {
          return element.path;
        });
        deletedNodes = _.difference(destContents, srcContents);
      }

      function unlink(item, callback) {
        fs.unlink(Path.join(path, item), callback);
      }

      async.each(deletedNodes, unlink, callback);
    });
  }

  function syncEach(entry, callback) {
    var dirPath = getDirPath(path, entry.path);
    var syncPath = Path.join(dirPath, entry.path);

    // Directory
    if(entry.contents) {
      return rsync.patch(fs, Path.join(path, entry.path), entry.contents, options, function(err) {
        if(err) {
          return callback(err);
        }

        removeNodes(Path.join(path, entry.path), entry.contents, callback);
      });
    }
    // Link
    else if (entry.link) {
      return fs.symlink(entry.link, syncPath, function(err){
        if(err) {
          return callback(err);
        }

        callback();
      });
    }
    // File
    if(entry.identical) {
      return callback();
    }

    fs.readFile(syncPath, function(err, data) {
      var raw;

      // Get slice of raw file from block's index
      function rawslice(index) {
        var start = index * options.size;
        var end = start + options.size > raw.length ? raw.length : start + options.size;

        return raw.slice(start, end);
      }

      if(err) {
        if(err.code !== 'ENOENT') {
          return callback(err);
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

      var buf = Buffer.concat(chunks);
      fs.writeFile(syncPath, buf, function(err) {
        if(err) {
          return callback(err);
        }

        if(!options.time) {
          return callback();
        }

        // Updates the modified time of the node
        fs.utimes(syncPath, entry.modified, entry.modified, function(err) {
          if(err) {
            return callback(err);
          }

          callback();
        });
      });
    });
  }

  // Remove deleted nodes in the destination path
  function removeNodesInParent(diff, callback) {
    callback = findCallback(callback, diff);
    fs.lstat(path, function(err, stats) {
      if(err) {
        return callback(err);
      }

      if(!stats.isDirectory()) {
        return callback();
      }

      removeNodes(path, diff, callback);
    });
  }

  if(diff) {
    async.each(diff, syncEach, function(err) {
      removeNodesInParent(diff, callback);
    });
  } else {
    removeNodesInParent(callback);
  }
};

module.exports = rsync;
