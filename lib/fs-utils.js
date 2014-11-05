/**
 * Extra common fs operations we do throughout MakeDrive.
 */
var constants = require('./constants.js');

// See if a given path a) exists, and whether it is marked with an xattr.
function hasAttr(fs, path, attr, callback) {
  fs.getxattr(path, attr, function(err, attrVal) {
    // File doesn't exist locally at all
    if(err && err.code === 'ENOENT') {
      return callback(null, false);
    }

    // Deal with unexpected error
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, !!attrVal);
  });
}

// Remove the metadata from a path or file descriptor
function removeAttr(fs, pathOrFd, attr, isFd, callback) {
  var removeFn = 'fremovexattr';

  if(isFd !== true) {
    callback = isFd;
    removeFn = 'removexattr';
  }

  fs[removeFn](pathOrFd, attr, function(err) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback();
  });
}

// Get the metadata for a path or file descriptor
function getAttr(fs, pathOrFd, attr, isFd, callback) {
  var getFn = 'fgetxattr';

  if(isFd !== true) {
    callback = isFd;
    getFn = 'getxattr';
  }

  fs[getFn](pathOrFd, attr, function(err, value) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, value);
  });
}

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
  hasAttr(fs, path, constants.attributes.unsynced, callback);
}

// Remove the unsynced metadata from a path
function removeUnsynced(fs, path, callback) {
  removeAttr(fs, path, constants.attributes.unsynced, callback);
}
function fremoveUnsynced(fs, fd, callback) {
  removeAttr(fs, fd, constants.attributes.unsynced, true, callback);
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
  getAttr(fs, path, constants.attributes.unsynced, callback);
}
function fgetUnsynced(fs, fd, callback) {
  getAttr(fs, fd, constants.attributes.unsynced, true, callback);
}

// Remove the Checksum metadata from a path
function removeChecksum(fs, path, callback) {
  removeAttr(fs, path, constants.attributes.checksum, callback);
}
function fremoveChecksum(fs, fd, callback) {
  removeAttr(fs, fd, constants.attributes.checksum, true, callback);
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
  getAttr(fs, path, constants.attributes.checksum, callback);
}
function fgetChecksum(fs, fd, callback) {
  getAttr(fs, fd, constants.attributes.checksum, true, callback);
}

// See if a given path a) exists, and whether it is marked partial.
function isPathPartial(fs, path, callback) {
  hasAttr(fs, path, constants.attributes.partial, callback);
}

// Remove the partial metadata from a path
function removePartial(fs, path, callback) {
  removeAttr(fs, path, constants.attributes.partial, callback);
}
function fremovePartial(fs, fd, callback) {
  removeAttr(fs, fd, constants.attributes.partial, true, callback);
}

// Set the partial metadata for a path
function setPartial(fs, path, nodeCount, callback) {
  fs.setxattr(path, constants.attributes.partial, nodeCount, callback);
}
function fsetPartial(fs, fd, nodeCount, callback) {
  fs.fsetxattr(fd, constants.attributes.partial, nodeCount, callback);
}

// Get the partial metadata for a path
function getPartial(fs, path, callback) {
  getAttr(fs, path, constants.attributes.partial, callback);
}
function fgetPartial(fs, fd, callback) {
  getAttr(fs, fd, constants.attributes.partial, true, callback);
}

// Set the pathsToSync metadata for a path
function setPathsToSync(fs, path, pathsToSync, callback) {
  fs.setxattr(path, constants.attributes.pathsToSync, pathsToSync, callback);
}
function fsetPathsToSync(fs, fd, pathsToSync, callback) {
  fs.fsetxattr(fd, constants.attributes.pathsToSync, pathsToSync, callback);
}

// Get the pathsToSync metadata for a path
function getPathsToSync(fs, path, callback) {
  getAttr(fs, path, constants.attributes.pathsToSync, callback);
}
function fgetPathsToSync(fs, fd, callback) {
  getAttr(fs, fd, constants.attributes.pathsToSync, true, callback);
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
  fgetChecksum: fgetChecksum,

  // Partial attr utils
  isPathPartial: isPathPartial,
  removePartial: removePartial,
  fremovePartial: fremovePartial,
  setPartial: setPartial,
  fsetPartial: fsetPartial,
  getPartial: getPartial,
  fgetPartial: fgetPartial,

  // Paths to sync utils
  setPathsToSync: setPathsToSync,
  fsetPathsToSync: fsetPathsToSync,
  getPathsToSync: getPathsToSync,
  fgetPathsToSync: fgetPathsToSync
};
