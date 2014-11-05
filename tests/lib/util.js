var expect = require('chai').expect;
var Filer = require('../../lib/filer.js');
var Buffer = Filer.Buffer;
var Path = Filer.Path;
var uuid = require( "node-uuid" );
var async = require('../../lib/async-lite.js');
var deepEqual = require('deep-equal');
var MD5 = require('MD5');

function uniqueUsername() {
  return 'user' + uuid.v4();
}

function comparePaths(a, b) {
  // If objects have a .path property, use it.
  if(a.path && b.path) {
    a = a.path;
    b = b.path;
  }
  if(a > b) return 1;
  if(a < b) return -1;
  return 0;
}

/**
 * Sync Helpers
 */
function generateSourceList(files) {
  return files.map(function(file) {
    return {
      path: file.path,
      modified: Math.floor(Math.random() * 10000000000),
      size: file.content.length,
      type: 'FILE'
    };
  });
}

function generateChecksums(files) {
  var sourceList = generateSourceList(files);

  return sourceList.map(function(file) {
    delete file.size;
    file.checksums = [];
    return file;
  });
}

function generateDiffs(files) {
  var checksums = generateChecksums(files);

  return checksums.map(function(file, index) {
    delete file.checksums;
    file.diffs = [{data: new Buffer(files[index].content)}];
    return file;
  });
}

function generateValidationChecksums(files) {
  return files.map(function(file) {
    return {
      path: file.path,
      type: 'FILE',
      checksum: MD5(new Buffer(file.content)).toString()
    };
  });
}

function createFilesystemLayout(fs, layout, callback) {
  var paths = Object.keys(layout);
  var sh = new fs.Shell();

  function createPath(path, callback) {
    var contents = layout[path];
    // Path is either a file (string/Buffer) or empty dir (null)
    if(contents) {
      sh.mkdirp(Path.dirname(path), function(err) {
        if(err) {
          return callback(err);
        }

        fs.writeFile(path, contents, callback);
      });
    } else {
      sh.mkdirp(path, callback);
    }
  }

  async.eachSeries(paths, createPath, callback);
}

/**
 * Deletes all paths specified in paths array, or everything
 * if no paths are given.
 */
function deleteFilesystemLayout(fs, paths, callback) {
  if(!paths) {
    fs.readdir('/', function(err, entries) {
      if(err) {
        return callback(err);
      }

      entries = entries.map(function(path) {
        return Path.join('/', path);
      });

      deleteFilesystemLayout(fs, entries, callback);
    });
  } else {
    var sh = new fs.Shell();
    var rm = function(path, callback) {
      sh.rm(path, {recursive: true}, callback);
    };
    async.eachSeries(paths, rm, callback);
  }
}

// Strip .modified times from ever element in the array, or its .contents
function stripModified(listing) {
  function strip(item) {
    delete item.modified;
    if(item.contents) {
      item.contents = stripModified(item.contents);
    }
    return item;
  }

  if(Array.isArray(listing)) {
    return listing.map(strip);
  } else {
    return strip(listing);
  }
}

/**
 * Makes sure that the layout given matches what's actually
 * in the current fs.  Use ensureFilesystemContents if you
 * want to ensure file/dir contents vs. paths.
 */
function ensureFilesystemLayout(fs, layout, callback) {
  // Start by creating the layout, then compare a deep ls()
  var fs2 = new Filer.FileSystem({provider: new Filer.FileSystem.providers.Memory(uniqueUsername())});
  createFilesystemLayout(fs2, layout, function(err) {
    if(err) {
      return callback(err);
    }

    var sh = new fs.Shell();
    sh.ls('/', {recursive: true}, function(err, fsListing) {
      if(err) {
        return callback(err);
      }

      var sh2 = new fs2.Shell();
      sh2.ls('/', {recursive: true}, function(err, fs2Listing) {
        if(err) {
          return callback(err);
        }

        // Remove modified
        fsListing = stripModified(fsListing);
        fs2Listing = stripModified(fs2Listing);

        expect(deepEqual(fsListing, fs2Listing, {ignoreArrayOrder: true, compareFn: comparePaths})).to.be.true;
        callback();
      });
    });
  });
}

/**
 * Ensure that the files and dirs match the layout's contents.
 * Use ensureFilesystemLayout if you want to ensure file/dir paths vs. contents.
 */
function ensureFilesystemContents(fs, layout, callback) {
  function ensureFileContents(filename, expectedContents, callback) {
    var encoding = Buffer.isBuffer(expectedContents) ? null : 'utf8';
    fs.readFile(filename, encoding, function(err, actualContents) {
      if(err) {
        return callback(err);
      }

      expect(actualContents).to.deep.equal(expectedContents);
      callback();
    });
  }

  function ensureEmptyDir(dirname, callback) {
    fs.stat(dirname, function(err, stats) {
      if(err) {
        return callback(err);
      }

      expect(stats.isDirectory()).to.be.true;

      // Also make sure it's empty
      fs.readdir(dirname, function(err, entries) {
        if(err) {
          return callback(err);
        }

        expect(entries.length).to.equal(0);
        callback();
      });
    });
  }

  function processPath(path, callback) {
    var contents = layout[path];
    if(contents) {
      ensureFileContents(path, contents, callback);
    } else {
      ensureEmptyDir(path, callback);
    }
  }

  async.eachSeries(Object.keys(layout), processPath, callback);
}

/**
 * Runs ensureFilesystemLayout and ensureFilesystemContents on fs
 * for given layout, making sure all paths and files/dirs match expected.
 */
function ensureFilesystem(fs, layout, callback) {
  ensureFilesystemLayout(fs, layout, function(err) {
    if(err) {
      return callback(err);
    }

    ensureFilesystemContents(fs, layout, callback);
  });
}

function disconnect(sync, callback) {
  sync.removeAllListeners();

  if(sync.state === sync.SYNC_DISCONNECTED) {
    return callback();
  }

  sync.once('disconnected', callback);
  sync.disconnect();
}

module.exports = {
  username: uniqueUsername,
  comparePaths: comparePaths,
  stripModified: stripModified,
  createFilesystemLayout: createFilesystemLayout,
  deleteFilesystemLayout: deleteFilesystemLayout,
  ensureFilesystemContents: ensureFilesystemContents,
  ensureFilesystemLayout: ensureFilesystemLayout,
  ensureFilesystem: ensureFilesystem,
  generateSourceList: generateSourceList,
  generateChecksums: generateChecksums,
  generateDiffs: generateDiffs,
  generateValidationChecksums: generateValidationChecksums,
  disconnectClient: disconnect
};
