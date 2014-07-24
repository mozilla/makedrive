/**
 * Utility functions for working with Conflicted Files.
 */

// Rename oldPath to newPath, deleting newPath if it exists
function forceRename(fs, oldPath, newPath, callback) {
  fs.rename(oldPath, newPath, function(err) {
    if(err) {
      if(err.code !== 'EEXIST') {
        return callback(err);
      } else {
        fs.rm(newPath, function(err) {
          if(err) {
            return callback(err);
          }

          forceRename(fs, oldPath, newPath, callback);
        });
      }
    }

    callback();
  });
}

// Turn "/index.html" into "/index.html (Conflicted Copy 2014-07-23 12:00:00).html"
function generateConflictedPath(fs, path, callback) {
  var now = new Date;
  var dateStamp = now.toDateString() + ' ' +
        now.getHours() + ':' +
        now.getMinutes() + ':' +
        now.getSeconds();
  var conflictedCopy = '(Conflicted Copy ' + dateStamp + ')';
  var conflictedPath = path.replace(/\.?([^.]*)$/, conflictedCopy + "$1");

  // Rename the path using the conflicted filename. If there is
  // already a conflicted path, replace it with this one.
  forceRename(fs, path, conflictedPath, function(err) {
    if(err) {
      return callback(err);
    }

    // Send the new path back on the callback
    callback(null, conflictedPath);
  });
}

function pathContainsConflicted(path) {
  // Look for path to be a conflicted copy, e.g.,
  // /dir/index (Conflicted Copy 2014-07-23).html
  return /\(Conflicted Copy[^)]+\)/.test(path);
}

function isConflicted(fs, path, callback) {
  fs.getxattr(path, 'makedrive-conflict', function(err, value) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback(null, !!value);
  });
}

function markConflicted(fs, path, callback) {
  fs.setxattr(path, 'makedrive-conflict', true, function(err) {
    if(err) {
      return callback(err);
    }

    generateConflictedPath(path, callback);
  });
}

function removeConflict(fs, path, callback) {
  fs.removexattr(path, 'makedrive-conflict', function(err) {
    if(err && err.code !== 'ENOATTR') {
      return callback(err);
    }

    callback();
  });
}

module.exports = {
  pathContainsConflicted: pathContainsConflicted,
  isConflicted: isConflicted,
  markConflicted: markConflicted,
  removeConflict: removeConflict
};
