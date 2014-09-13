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
var Errors = require('../filer').Errors;
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

// This function has been taken from lodash
// Licensed under the MIT license
// https://github.com/lodash/lodash
function sortObjects(list, prop) {
  return list.sort(function(a,b) {
    a = a[prop];
    b = b[prop];
    return (a === b) ? 0 : (a < b) ? -1 : 1;
  });
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

// Generate checksums for an array of paths to be used for comparison
function generateChecksums(fs, paths, blockSize, callback) {
  if(!blockSize || typeof callback !== 'function') {
    return callback(new Errors.EINVAL('Insufficient data provided'));
  }

  var paramError = validateParams(fs, paths);
  if(paramError) {
    return callback(paramError);
  }

  var checksums = [];

  function ChecksumNode(path, checksum) {
    this.path = path;
    this.checksum = checksum || [];
  }

  function calcChecksum(path, callback) {
    var checksumNode;

    fs.lstat(path, function(err, stat) {
      if(err) {
        if(err.code !== 'ENOENT') {
          return callback(err);
        }

        checksumNode = new ChecksumNode(path);
        checksums.push(checksumNode);

        return callback();
      }

      // Use contents of directory instead of checksums
      if(stat.isDirectory()) {
        checksumNode = new ChecksumNode(path);
        checksums.push(checksumNode);
        return callback();
      }

      fsUtils.isPathUnsynced(fs, path, function(err, unsynced) {
        if(err) {
          return callback(err);
        }

        if(unsynced) {
          return callback();
        }

        // Calculate checksums for file or symbolic links
        checksum(fs, path, blockSize, function(err, chksum) {
          if(err) {
            return callback(err);
          }

          checksumNode = new ChecksumNode(path, chksum);
          checksums.push(checksumNode);

          callback();
        });
      });
    });
  }

  async.eachSeries(paths, calcChecksum, function(err) {
    if(err) {
      return callback(err);
    }

    callback(null, checksums);
  });
}

// Compare two file systems. This is done by comparing the 
// checksums for a collection of paths in one file system 
// against the checksums for the same those paths in 
// another file system
function compareContents(fs, checksums, blockSize, callback) {
  var EDIFF = 'DIFF';

  if(!blockSize || typeof callback !== 'function') {
    return callback(new Errors.EINVAL('Insufficient data provided'));
  }

  var paramError = validateParams(fs, checksums);
  if(paramError) {
    return callback(paramError);
  }

  // Check if two checksum arrays are equal
  function isEqual(checksumNode1, checksumNode2) {
    var comparisonLength = checksumNode2.length;
    var checksum1, checksum2;

    if(checksumNode1.length !== comparisonLength) {
      return false;
    }

    // Sort the checksum objects in each array by the 'index' property
    checksumNode1 = sortObjects(checksumNode1, 'index');
    checksumNode2 = sortObjects(checksumNode2, 'index');

    // Compare each object's checksums
    for(var i = 0; i < comparisonLength; i++) {
      checksum1 = checksumNode1[i];
      checksum2 = checksumNode2[i];

      if(checksum1.weak !== checksum2.weak ||
        checksum1.strong !== checksum2.strong) {
        return false;
      }
    }

    return true;
  }

  function compare(checksumNode, callback) {
    var path = checksumNode.path;

    fs.lstat(path, function(err, stat) {
      if(err) {
        if(err.code !== 'ENOENT') {
          return callback(err);
        }

        // Checksums for a non-existent path are empty
        if(checksumNode.checksum && !checksumNode.checksum.length) {
          return callback();
        }

        return callback(EDIFF);
      }

      // Directory comparison of contents
      if(stat.isDirectory()) {
        return callback();
      }

      if(!checksumNode.checksum) {
        return callback(EDIFF);
      }

      // Compare checksums for two files/symbolic links
      checksum(fs, path, blockSize, function(err, checksum) {
        if(err) {
          return callback(err);
        }

        if(!isEqual(checksum, checksumNode.checksum)) {
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
}

module.exports = {
  checksum: checksum,
  rollData: roll,
  generateChecksums: generateChecksums,
  compareContents: compareContents,
  configureOptions: configureOptions,
  findCallback: findCallback,
  validateParams: validateParams
};
