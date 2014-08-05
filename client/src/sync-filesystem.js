/**
 * An extended Filer FileSystem with wrapped methods
 * for writing that manage file metadata (xattribs)
 * reflecting sync state.
 */

var Filer = require('../../lib/filer.js');
var fsUtils = require('../../lib/fs-utils.js');
var conflict = require('../../lib/conflict.js');
var constants = require('../../lib/constants.js');

function SyncFileSystem(fs) {
  var self = this;

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
    fsUtils.fsetUnsynced(fs, fd, callback);
  }

  function setUnsynced(path, callback) {
    fsUtils.setUnsynced(fs, path, callback);
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
           return callback(args[0]);
         }

         setUnsyncedFn(pathOrFD, function(err) {
           if(err) {
             return callback(err);
           }
           callback.apply(null, args);
         });
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
  self.getUnsynced = function(path, callback) {
    fsUtils.getUnsynced(fs, path, callback);
  };
  self.fgetUnsynced = function(fd, callback) {
    fsUtils.fgetUnsynced(fs, fd, callback);
  };
}

module.exports = SyncFileSystem;
