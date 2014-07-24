var Filer = require('../../lib/filer.js');
var conflict = require('../../lib/conflict.js');

function SyncFileSystem(options) {
  var self = this;
  var fs = new Filer.FileSystem(options);

  // The following non-modifying fs operations can be run as normal,
  // and are simply forwarded to the fs instance. NOTE: we have
  // included setting xattributes since we don't sync these to the server.
  // Also note that fs.unlink is here since we don't want to flag such changes.
  ['stat', 'fstat', 'lstat', 'exists', 'readlink', 'realpath',
   'rmdir', 'readdir', 'open', 'close', 'fsync', 'read', 'readFile',
   'setxattr', 'fsetxattr', 'getxattr', 'fgetxattr', 'removexattr',
   'fremovexattr', 'watch', 'unlink'].forEach(function(method) {
     self[method] = function() {
       fs[method].apply(fs, arguments);
     };
  });

  function fsetUnsynced(fd, callback) {
    fs.fsetxattr(fd, 'makedrive-unsynced', Date.now(), callback);
  }

  function setUnsynced(path, callback) {
    fs.setxattr(path, 'makedrive-unsynced', Date.now(), callback);
  }

  // These methods modify the filesystem. Wrap these calls.
  ['rename', 'truncate', 'link', 'symlink', 'mknod', 'mkdir',
   'utimes', 'writeFile','ftruncate', 'futimes', 'write',
   'appendFile'].forEach(function(method) {
     self[method] = function() {
       var args = Array.prototype.slice.call(arguments, 0);
       var lastIdx = args.length - 1;
       var callback = args[lastIdx];

       // Grab the path or fd so we can use it to set the xattribute.
       // Most methods take `path` or `fd` as the first arg, but it's
       // second for some.
       var pathOrFD;
       switch(method) {
         case 'rename':
         case 'link':
         case 'symlink':
           pathOrFD = args[1];
           break;
         default:
           pathOrFD = args[0];
           break;
       }

       // Figure out which function to use when setting the xattribute
       // depending on whether this method uses paths or descriptors.
       var setUnsyncedFn;
       switch(method) {
         case 'ftruncate':
         case 'futimes':
         case 'write':
           setUnsyncedFn = fsetUnsynced;
           break;
         default:
           setUnsyncedFn = setUnsynced;
           break;
       }

       args[lastIdx] = function wrappedCallback() {
         var args = Array.prototype.slice.call(arguments, 0);
         if(args[0]) {
           callback(args[0]);
         } else {
           setUnsyncedFn(pathOrFD, function(err) {
             if(err) {
               callback(err);
             } else {
               callback.apply(null, args);
             }
           });
         }
       };

       fs[method].apply(fs, args);
     };
  });

  // We also want to do extra work in the case of a rename.
  // If a file is a conflicted copy, and a rename is done,
  // remove the conflict.
  var rename = self.rename;
  self.rename = function(oldPath, newPath, callback) {
    rename(oldPath, newPath, function(err) {
      if(err) {
        return callback(err);
      }

      conflict.isConflictedCopy(fs, newPath, function(err, conflicted) {
        if(err) {
          return callback(err);
        }

        if(conflicted) {
          conflict.removeFileConflict(fs, newPath, callback);
        } else {
          callback();
        }
      });
    });
  };

  // Expose fs.Shell()
  self.Shell = function(options) {
    return fs.Shell(options);
  };

  // Expose extra operations for checking whether path/fd is unsynced
  self.removeUnsynced = function(path, callback) {
    fs.removexattr(path, 'makedrive-unsynced', function(err) {
      if(err && err.code !== 'ENOATTR') {
        return callback(err);
      }

      callback();
    });
  };
  self.fremoveUnsynced = function(fd, callback) {
    fs.fremovexattr(fd, 'makedrive-unsynced', function(err) {
      if(err && err.code !== 'ENOATTR') {
        return callback(err);
      }

      callback();
    });
  };
/** Note sure if we need to expose this or not, probably not.
  self.setUnsynced = function(path, callback) {
    fs.setxattr(path, 'makedrive-unsynced', true, function(err) {
      if(err) {
        return callback(err);
      }

      callback();
    });
  };
  self.fsetUnsynced = function(fd, callback) {
    fs.fsetxattr(fd, 'makedrive-unsynced', true, function(err) {
      if(err) {
        return callback(err);
      }

      callback();
    });
  };
**/
  self.getUnsynced = function(path, callback) {
    fs.getxattr(path, 'makedrive-unsynced', function(err, value) {
      if(err && err.code !== 'ENOATTR') {
        return callback(err);
      }

      callback(null, !!value);
    });
  };
  self.fgetUnsynced = function(fd, callback) {
    fs.fgetxattr(fd, 'makedrive-unsynced', function(err, value) {
      if(err && err.code !== 'ENOATTR') {
        return callback(err);
      }

      callback(null, !!value);
    });
  };
}

module.exports = SyncFileSystem;
