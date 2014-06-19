// rsync.js
// Implement rsync to sync between two Filer filesystems
// Portions used from Node.js Anchor module
// Copyright(c) 2011 Mihai Tomescu <matomesc@gmail.com>
// Copyright(c) 2011 Tolga Tezel <tolgatezel11@gmail.com>
// MIT Licensed
// https://github.com/ttezel/anchor

// Rsync chunk size
var DEFAULT_SIZE = 512;

var Filer = require('filer'),
    Path = Filer.Path,
    Errors = Filer.Errors,
    CryptoJS = require('crypto-js'),
    async = require('async'),
    _ = require('lodash'),
    rsync = {};

// Configure options passed
// Options that can be passed are:
// size       -   the size of each chunk of data in bytes that should be checksumed
// checksum   -   true: always calculate checksums
//                false: ignore checksums for identical files
// recursive  -   true: sync each contained node in the path provided
//                false: only sync the node for the path provided
// time       -   true: sync modified times of source/destination files
//                false: do not change modified times of destination files
// links      -   true: sync symbolic links as links in destination
//                false: sync symbolic links as the files the link to in destination
// Configure options passed
function configureOptions() {
  var options;

  if(typeof this === 'function') {
    options = {};
    options.size = DEFAULT_SIZE;
    options.checksum = true;
    options.recursive = false;
    options.time = false;
    options.links = false;
    options.delete = false;
  } else {
    options = this || {};
    options.size = options.size || DEFAULT_SIZE;
    options.checksum = typeof options.checksum === 'undefined' ? true : options.checksum;
    options.recursive = options.recursive || false;
    options.time = options.time || false;
    options.links = options.links || false;
    options.delete = options.delete || false;
  }
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
function _md5(data) {
  var wordArray = CryptoJS.lib.WordArray.create(data).toString();
  return CryptoJS.MD5(wordArray).toString();
}

// Weak32 hashing for RSync based on Mark Adler's 32bit checksum algorithm
function _weak32(data, prev, start, end) {
  var a = 0;
  var b = 0;
  var sum = 0;
  var M = 1 << 16;
  var N = 65521;

  if (!prev) {
    var len = start >= 0 && end >= 0 ? end - start + 1 : data.length;
    var i = 0;

      for (; i < len; i++) {
        a += data[i];
        b += ((len - i + 1) * data[i]);
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
function _weak16(data) {
  return 0xffff & (data >> 16 ^ data*1009);
}

// RSync algorithm to create a hashtable from checksums
function createHashtable(checksums) {
  var hashtable = {};
  var len = checksums.length;
  var i = 0;

  for (; i < len; i++) {
    var checksum = checksums[i];
    var weak16 = _weak16(checksum.weak);
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

  for (; end <= length; start++, end++) {
    var weak = _weak32(data, prevRollingWeak, start, end);
    var weak16 = _weak16(weak.sum);
    var match = false;
    var d;
    prevRollingWeak = weak;

    if (hashtable[weak16]) {
      var len = hashtable[weak16].length;
      var i = 0;
      for (; i < len; i++) {
        if (hashtable[weak16][i].weak === weak.sum) {
          var mightMatch = hashtable[weak16][i];
          var chunk = data.subarray(start, end);
          var strong = _md5(chunk);

          if (mightMatch.strong === strong) {
            match = mightMatch;
            break;
          }
        }
      }
    }
    if (match) {
      if(start < lastMatchedEnd) {
        d = data.subarray(lastMatchedEnd - 1, end);
        results.push({
          data: d,
          index: match.index
        });
      } else if (start - lastMatchedEnd > 0) {
        d = data.subarray(lastMatchedEnd, start);
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
      d = data.subarray(lastMatchedEnd);
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
    }
    else if (err && err.code === 'ENOENT') {
      cache[path] = [];
    }
    else {
      return callback(err);
    }
    var length = cache[path].length;
    var incr = options.size;
    var start = 0;
    var end = incr > length ? length : incr;
    var blockIndex = 0;
    var result = [];

    while (start < length) {
      var chunk  = cache[path].subarray(start, end);
      var weak   = _weak32(chunk).sum;
      var strong = _md5(chunk);

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
rsync.sourceList = function getSrcList(srcFS, path, options, callback) {
  callback = findCallback(callback, options);

  var paramError = validateParams(srcFS, path);

  if(paramError) {
    return callback(paramError);
  }

  configureOptions.call(options);

  var result = [];

  srcFS.lstat(path, function(err, stats) {
    if(err) {
      return callback(err);
    }
    if(stats.isDirectory()) {
      srcFS.readdir(path, function(err, entries) {
        if(err) {
          return callback(err);
        }

        function getSrcContents(_name, callback) {
          var name = Path.join(path, _name);
          srcFS.lstat(name, function(error, stats) {

            if(error) {
              return callback(error);
            }

            var entry = {
              node: stats.node,
              path: Path.basename(name),
              modified: stats.mtime,
              size: stats.size,
              type: stats.type
            };
            if(options.recursive && stats.isDirectory()) {
              getSrcList(srcFS, name, options, function(error, items) {
                if(error) {
                  return callback(error);
                }
                entry.contents = items;
                result.push(entry);
                callback();
              });
            } else if(stats.isFile() || !options.links) {
              result.push(entry);
              callback();
            } else if (entry.type === 'SYMLINK'){
              result.push(entry);
              callback();
            }
          });
        }

        async.each(entries, getSrcContents, function(error) {
          callback(error, result);
        });
      });
    }
    else {
      var entry = {
        node: stats.node,
        path: Path.basename(path),
        size: stats.size,
        type: stats.type,
        modified: stats.mtime
      };
      result.push(entry);
      callback(err, result);
    }
  });
};

// Generate checksums for every node in a given destination path
rsync.checksums = function(fs, destPath, srcList, options, callback) {
  callback = findCallback(callback, options);

  var paramError = validateParams(fs, destPath);

  if(paramError) {
    return callback(paramError);
  }

  configureOptions.call(options);
  var result = [];

  function getDirChecksums(entry, callback) {
    var item = { path: entry.path, node: entry.node };
    var dirPath = getDirPath(destPath, entry.path);
    var absPath = Path.join(dirPath, entry.path);

    if(options.recursive && entry.type === 'DIRECTORY') {
      var path = Path.join(destPath, entry.path);
      // Create the directory if it does not exist
      fs.mkdir(path, function(err) {
        if(err && err.code !== 'EEXIST') {
          return callback(err);
        }
        rsync.checksums(fs, path, entry.contents, options, function(error, items) {
          if(error) {
            return callback(error);
          }
          // for empty directories where items is undefined
          item.contents = items || [];
          result.push(item);
          callback();
        });
      });
    } else if(entry.type === 'FILE' || !options.links) {
      // Make parent directories that do not exist
      fs.mkdir(dirPath, function(err) {
        if(err && err.code !== 'EEXIST') {
          return callback(err);
        }
        if(!options.checksum || options.recursive) {
          fs.stat(absPath, function(err, stat) {
            if(!err && stat.mtime === entry.modified && stat.size === entry.size) {
              item.checksums = [];
              item.modified = entry.modified;
              // Indicates that the item is identical to the item in the source
              item.identical = true;
              result.push(item);
              callback();
            }
            else {
              checksum.call(fs, absPath, options, function(err, checksums) {
                if(err) {
                  return callback(err);
                }
                item.checksums = checksums;
                item.modified = entry.modified;
                result.push(item);
                callback();
              });
            }
          });
        } else {
          checksum.call(fs, absPath, options, function(err, checksums) {
            if(err) {
              return callback(err);
            }
            item.checksums = checksums;
            item.modified = entry.modified;
            result.push(item);
            callback();
          });
        }
      });
    }
    else if(entry.type === 'SYMLINK'){
      // Make parent directories that do not exist
      fs.mkdir(dirPath, function(err) {
        if(err && err.code !== 'EEXIST') {
          return callback(err);
        }
        if(!options.checksum || options.recursive) {
          fs.stat(absPath, function(err, stat){
            if(!err && stat.mtime === entry.modified && stat.size === entry.size) {
              item.link = true;
              result.push(item);
              callback();
            }
            else {
              item.link = true;
              result.push(item);
              callback();
            }
          });
        } else {
          item.link = true;
          result.push(item);
          callback();
        }
      });
    }
  }
  async.each(srcList, getDirChecksums, function(error) {
    if(error) {
      callback(error);
    } else if (result.length === 0) {
      callback(null, result);
    } else {
      callback(null, result);
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

  configureOptions.call(options);

  if(options.checksum && !checksums) {
    return callback(new Errors.EINVAL('Checksums must be provided'));
  }

  var itemDiffs = [];

  fs.lstat(path, function(err, stat) {
    if(stat.isDirectory()) {
      async.each(checksums, getDiff, function(err) {
        if(err) {
          return callback(err);
        }
        callback(null, itemDiffs);
      });
    }
    else if (stat.isFile() || !options.links) {
      if(checksums[0].identical) {
        itemDiffs.push({
          diffs: [],
          modified: checksums[0].modified,
          path: checksums[0].path,
          identical: true
        });
        callback(null, itemDiffs);
      } else {
        fs.readFile(path, function (err, data) {
          if (err) {
            return callback(err);
          }
          itemDiffs.push({
            diffs: roll(data, checksums[0].checksums, options.size),
            modified: checksums[0].modified,
            path: checksums[0].path
          });
          if(err) {
            return callback(err);
          }
          callback(null, itemDiffs);
        });
      }
    }
    else if (stat.isSymbolicLink()) {
      fs.readlink(path, function(err, linkContents) {
        if(err) {
          return callback(err);
        }
        fs.lstat(path, function(err, stats){
          if(err) {
            return callback(err);
          }
          itemDiffs.push({
            link: linkContents,
            modified: stats.mtime,
            path: checksums[0].path
          });
          callback(null, itemDiffs);
        });
      });
    }
  });

  function getDiff(entry, callback) {
    var entryPath = Path.join(path, entry.path);

    if(entry.hasOwnProperty('contents')) {
      rsync.diff(fs, entryPath, entry.contents, options, function(err, diffs) {
        if(err) {
          return callback(err);
        }
        itemDiffs.push({
          path: entry.path,
          contents: diffs
        });
        callback();
      });
    } else if (entry.hasOwnProperty('link')) {
      fs.readlink(entryPath, function(err, linkContents) {
        if(err) {
          return callback(err);
        }
        fs.lstat(entryPath, function(err, stats){
          if(err) {
            return callback(err);
          }
          itemDiffs.push({
            link: linkContents,
            modified: stats.mtime,
            path: entry.path
          });
          callback(err, itemDiffs);
        });
      });
    } else {
      if(entry.identical) {
        itemDiffs.push({
          diffs: [],
          modified: entry.modified,
          path: entry.path,
          // Indicates that since the checksum was identical to the source, no diffs should be applied
          identical: true
        });
        callback(null, itemDiffs);
      } else {
        fs.readFile(entryPath, function (err, data) {
          if (err) {
            return callback(err);
          }
          itemDiffs.push({
            diffs: roll(data, entry.checksums, options.size),
            modified: entry.modified,
            path: entry.path
          });
          callback(null, itemDiffs);
        });
      }
    }
  }
};

// Path the destination filesystem by applying diffs
rsync.patch = function(fs, path, diff, options, callback) {
  callback = findCallback(callback, options);

  var paramError = validateParams(fs, path);

  if(paramError) {
    return callback(paramError);
  }

  configureOptions.call(options, callback);

  // Remove the nodes in the patched directory that are no longer present in the source
  function removeNodes(destPath, entryDiff, callback) {
    if(typeof entryDiff === 'function') {
      callback = entryDiff;
      entryDiff = null;
    }

    fs.readdir(destPath, function(err, destContents) {
      if(err) {
        return callback(err);
      }
      var deletedNodes = destContents;

      if(entryDiff) {
        var srcContents = !entryDiff ? [] : entryDiff.map(function(element) {
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

    if(entry.hasOwnProperty('contents')) {
      return rsync.patch(fs, Path.join(path, entry.path), entry.contents, options, function(err) {
        if(err) {
          return callback(err);
        }
         removeNodes(Path.join(path, entry.path), entry.contents, callback);
      });
    }

    if (entry.hasOwnProperty('link')) {
      return fs.symlink(entry.link, syncPath, function(err){
        if(err) {
          return callback(err);
        }
        callback();
      });
    }

    if(!entry.identical) {
      return fs.readFile(syncPath, function(err, data) {
        var raw;

        //get slice of raw file from block's index
        function rawslice(index) {
          var start = index*options.size;
          var end = start + options.size > raw.length ? raw.length : start + options.size;

          return raw.subarray(start, end);
        }
        if(err) {
          if(err.code !== 'ENOENT') {
            return callback(err);
          }
          raw = new Uint8Array();
        } else {
          raw = data;
        }

        var len = entry.diffs.length;
        var buf = new Uint8Array();

        for(var i = 0; i < len; i++) {
          var chunk = entry.diffs[i];

          if(!chunk.data) {
            //use slice of original file
            buf = appendBuffer(buf, rawslice(chunk.index));
          } else {
            buf = appendBuffer(buf, chunk.data);
            if(chunk.index) {
              buf = appendBuffer(buf, rawslice(chunk.index));
            }
          }
        }
        return fs.writeFile(syncPath, buf, function(err) {
          if(err) {
            return callback(err);
          }
          if(options.time) {
            fs.utimes(syncPath, entry.modified, entry.modified, function(err) {
              if(err) {
                return callback(err);
              }
              callback();
            });
          }
          else {
            callback();
          }
        });
      });
    }
    callback();
  }

  // Remove deleted nodes in the destination path
  function removeNodesInParent(diff, callback) {
    callback = findCallback(callback, diff);
    fs.lstat(path, function(err, stats) {
      if(err) {
        return callback(err);
      }
      if(stats.isDirectory()) {
        return removeNodes(path, diff, callback);
      }
      callback();
    });
  }

  if(diff) {
    return async.each(diff, syncEach, function(err) {
      removeNodesInParent(diff, callback);
    });
  }
  removeNodesInParent(callback);
};

// Concatenate two Uint8Array buffers
function appendBuffer( buffer1, buffer2 ) {
  var tmp = new Uint8Array( buffer1.byteLength + buffer2.byteLength );

  tmp.set( new Uint8Array( buffer1 ), 0 );
  tmp.set( new Uint8Array( buffer2 ), buffer1.byteLength );
  return tmp;
}

module.exports = rsync;
