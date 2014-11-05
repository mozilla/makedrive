/*
 * Rsync utilities that include hashing
 * algorithms necessary for rsync and
 * checksum comparison algorithms to check
 * the equivalency of two file systems
 * as well as general validation functions
 *
 * Portions used from Node.js Anchor module
 * Copyright(c) 2011 Mihai Tomescu <matomesc@gmail.com>
 * Copyright(c) 2011 Tolga Tezel <tolgatezel11@gmail.com>
 * MIT Licensed
 * https://github.com/ttezel/anchor
*/

var MD5 = require('MD5');
var Filer = require('filer');
var Errors = Filer.Errors;
var Path = Filer.Path;
var async = require('../async-lite');
var fsUtils = require('../fs-utils');

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
// versions   -   true: do not sync a node if the last synced version matches the version it needs to be synced to [default]
//                false: sync nodes irrespective of the last synced version
// superficial-   true: if a directory path is provided, only sync the directory and not it's contents
//                false: if a directory path is provided, sync it's contents [default]
function configureOptions(options) {
  if(!options || typeof options === 'function') {
    options = {};
  }

  options.size = options.size || 512;
  options.checksum = options.checksum !== false;
  options.recursive = options.recursive || false;
  options.time = options.time || false;
  options.links = options.links || false;
  options.versions = options.versions !== false;
  options.superficial = options.superficial || false;

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
function validateParams(fs, param2) {
  var err;

  if(!fs) {
    err = new Errors.EINVAL('No filesystem provided');
  } else if(!param2) {
    err = new Errors.EINVAL('Second argument must be specified');
  }

  return err;
}

// MD5 hashing for RSync
function md5sum(data) {
  return MD5(data).toString();
}

// Weak32 hashing for RSync based on Mark Adler's 32bit checksum algorithm
function calcWeak32(data, prev, start, end) {
  var a = 0;
  var b = 0;
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
function roll(data, checksums, blockSize) {
  var results = [];
  var hashtable = createHashtable(checksums);
  var length = data.length;
  var start = 0;
  var end = blockSize > length ? length : blockSize;
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

// Rsync function to calculate checksums for
// a file by dividing it into blocks of data
// whose size is passed in and checksuming each
// block of data
function blockChecksums(fs, path, size, callback) {
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

// Generate the MD5 hash for the data of a file
// in its entirety
function getChecksum(fs, path, callback) {
  fs.readFile(path, function(err, data) {
    if(!err) {
      callback(null, md5sum(data));
    } else if(err.code === 'ENOENT') {
      // File does not exist so the checksum is an empty string
      callback(null, "");
    } else {
      callback(err);
    }
  });
}

// Generate checksums for an array of paths to be used for comparison
// It also takes an optional parameter called stampNode, a boolean which
// indicates whether the checksum should be stamped as an xattr on the node.
function generateChecksums(fs, paths, stampNode, callback) {
  // Maybe stampNode was not passed in
  if(typeof callback !== 'function') {
    callback = findCallback(callback, stampNode);
    stampNode = false;
  }

  var paramError = validateParams(fs, paths);
  if(paramError) {
    return callback(paramError);
  }

  var checksumList = [];

  function ChecksumNode(path, type, checksum) {
    this.path = path;
    this.type = type;
    this.checksum = checksum;
  }

  function addChecksumNode(path, nodeType, checksum, callback) {
    var checksumNode;

    // If no checksum was passed in
    if(typeof checksum === 'function') {
      callback = checksum;
      checksumNode = new ChecksumNode(path, nodeType);
    } else {
      checksumNode = new ChecksumNode(path, nodeType, checksum);
    }

    checksumList.push(checksumNode);
    callback();
  }

  // Only calculate the checksums for synced paths
  function maybeAddChecksumNode(path, nodeType, callback) {
    fsUtils.isPathUnsynced(fs, path, function(err, unsynced) {
      if(err) {
        return callback(err);
      }

      if(unsynced) {
        return callback();
      }

      getChecksum(fs, path, function(err, checksum) {
        if(err) {
          return callback(err);
        }
        // If we shouldn't add the checksum stamp or
        // the node does not exist (cannot add a stamp)
        // immediately add the checksum
        if(!stampNode || checksum === "") {
          return addChecksumNode(path, nodeType, checksum, callback);
        }

        // Stamp the node with the checksum
        fsUtils.setChecksum(fs, path, checksum, function(err) {
          if(err) {
            return callback(err);
          }

          addChecksumNode(path, nodeType, checksum, callback);
        });
      });
    });
  }

  function calcChecksum(path, callback) {
    fs.lstat(path, function(err, stat) {
      var nodeType = stat && stat.type;

      if(err) {
        if(err.code !== 'ENOENT') {
          return callback(err);
        }

        // Checksums for non-existent files
        maybeAddChecksumNode(path, nodeType, callback);
      } else if(stat.isDirectory()) {
        // Directory checksums are not calculated i.e. are undefined
        addChecksumNode(path, nodeType, callback);
      } else {
        // Checksums for synced files/links
        maybeAddChecksumNode(path, nodeType, callback);
      }
    });
  }

  async.eachSeries(paths, calcChecksum, function(err) {
    if(err) {
      return callback(err);
    }

    callback(null, checksumList);
  });
}

// Compare two file systems. This is done by comparing the
// checksums for a collection of paths in one file system
// against the checksums for the same those paths in
// another file system
function compareContents(fs, checksumList, callback) {
  var ECHKSUM = "Checksums do not match";

  var paramError = validateParams(fs, checksumList);
  if(paramError) {
    return callback(paramError);
  }

  function compare(checksumNode, callback) {
    var path = checksumNode.path;

    fs.lstat(path, function(err, stat) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      // If the types of the nodes on each fs do not match
      // i.e. /a is a file on fs1 and /a is a directory on fs2
      if(!err && checksumNode.type !== stat.type) {
        return callback(ECHKSUM);
      }

      // If the node type is a directory, checksum should not exist
      if(!err && stat.isDirectory()) {
        if(!checksumNode.checksum) {
          return callback();
        }

        callback(ECHKSUM);
      }

      // Checksum comparison for a non-existent path or file/link
      getChecksum(fs, path, function(err, checksum) {
        if(err) {
          return callback(err);
        }

        if(checksum !== checksumNode.checksum) {
          return callback(ECHKSUM);
        }

        callback();
      });
    });
  }

  async.eachSeries(checksumList, compare, function(err) {
    if(err && err !== ECHKSUM) {
      return callback(err);
    }

    callback(null, err !== ECHKSUM);
  });
}

function del(fs, path, callback) {
  var paramError = validateParams(fs, path);
  if(paramError) {
    return callback(paramError);
  }

  fs.lstat(path, function(err, stats) {
    if(err) {
      return callback(err);
    }

    if(stats.isDirectory()) {
      fs.rmdir(path, callback);
    } else {
      fs.unlink(path, callback);
    }
  });
}

function rename(fs, oldPath, newPath, callback) {
  var paramError = validateParams(fs, oldPath) && (newPath ? null : new Errors.EINVAL('New name not specified'));
  if(paramError) {
    return callback(paramError);
  }

  if(Path.dirname(oldPath) !== Path.dirname(newPath)) {
    return callback(new Errors.EINVAL('New path name does not have the same parent as the old path'));
  }

  fs.rename(oldPath, newPath, callback);
}

module.exports = {
  blockChecksums: blockChecksums,
  getChecksum: getChecksum,
  rollData: roll,
  generateChecksums: generateChecksums,
  compareContents: compareContents,
  configureOptions: configureOptions,
  findCallback: findCallback,
  validateParams: validateParams,
  del: del,
  rename: rename
};
