var fsUtils = require('../../lib/fs-utils.js');
var async = require('async');

// Check whether a list of paths have the unsynced attribute attached
// The 'unsynced' flag indicates what to check for. true makes sure that
// the paths have the unsynced attribute while false makes sure that they don't.
function checkUnsyncedAttr(fs, layout, expected, callback) {
  var error;
  var paths = Object.keys(layout);

  function isUnsynced(path, callback) {
    fsUtils.isPathUnsynced(fs, path, function(err, hasAttr) {
      if(err) {
        error = err;
        return callback(false);
      }

      callback(expected === hasAttr);
    });
  }

  async.every(paths, isUnsynced, function(result) {
    if(error) {
      return callback(error);
    }

    callback(null, result);
  });
}

module.exports = checkUnsyncedAttr;