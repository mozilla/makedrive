/**
 * Extra common fs operations we do throughout MakeDrive.
 */
var constants = require('./constants.js');

// copy oldPath to newPath, deleting newPath if it exists
function forceCopy(fs, oldPath, newPath, callback) {
  fs.unlink(newPath, function(err) {
    if(err && err.code !== 'ENOENT') {
      return callback(err);
    }

    fs.readFile(oldPath, function(err, buf) {
      if(err) {
        return callback(err);
      }

      fs.writeFile(newPath, buf, callback);
    });
  });
}

// See if a given path a) exists, and whether it is marked unsynced.
function isPathUnsynced(fs, path, callback) {
  fs.getxattr(path, constants.attributes.unsynced, function(err, unsynced) {
    // File doesn't exist locally at all
    if(err && err.code === 'ENOENT') {
      return callback(null, false);
    }

    // Deal with unexpected error
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, !!unsynced);
  });
}

// Remove the unsynced metadata from a path
function removeUnsynced(fs, path, callback) {
  fs.removexattr(path, constants.attributes.unsynced, function(err) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback();
  });
}
function fremoveUnsynced(fs, fd, callback) {
  fs.fremovexattr(fd, constants.attributes.unsynced, function(err) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback();
  });
}

// Set the unsynced metadata for a path
function setUnsynced(fs, path, callback) {
  fs.setxattr(path, constants.attributes.unsynced, Date.now(), callback);
}
function fsetUnsynced(fs, fd, callback) {
  fs.fsetxattr(fd, constants.attributes.unsynced, Date.now(), callback);
}

// Get the unsynced metadata for a path
function getUnsynced(fs, path, callback) {
  fs.getxattr(path, constants.attributes.unsynced, function(err, value) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, value);
  });
}
function fgetUnsynced(fs, fd, callback) {
  fs.fgetxattr(fd, constants.attributes.unsynced, function(err, value) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, value);
  });
}

// Remove the Checksum metadata from a path
function removeChecksum(fs, path, callback) {
  fs.removexattr(path, constants.attributes.checksum, function(err) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback();
  });
}
function fremoveChecksum(fs, fd, callback) {
  fs.fremovexattr(fd, constants.attributes.checksum, function(err) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback();
  });
}

// Set the Checksum metadata for a path
function setChecksum(fs, path, checksum, callback) {
  fs.setxattr(path, constants.attributes.checksum, checksum, callback);
}
function fsetChecksum(fs, fd, checksum, callback) {
  fs.fsetxattr(fd, constants.attributes.checksum, checksum, callback);
}

// Get the Checksum metadata for a path
function getChecksum(fs, path, callback) {
  fs.getxattr(path, constants.attributes.checksum, function(err, value) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, value);
  });
}
function fgetChecksum(fs, fd, callback) {
  fs.fgetxattr(fd, constants.attributes.checksum, function(err, value) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, value);
  });
}

module.exports = {
  forceCopy: forceCopy,

  // Unsynced attr utils
  isPathUnsynced: isPathUnsynced,
  removeUnsynced: removeUnsynced,
  fremoveUnsynced: fremoveUnsynced,
  setUnsynced: setUnsynced,
  fsetUnsynced: fsetUnsynced,
  getUnsynced: getUnsynced,
  fgetUnsynced: fgetUnsynced,

  // Checksum attr utils
  removeChecksum: removeChecksum,
  fremoveChecksum: fremoveChecksum,
  setChecksum: setChecksum,
  fsetChecksum: fsetChecksum,
  getChecksum: getChecksum,
  fgetChecksum: fgetChecksum
};
