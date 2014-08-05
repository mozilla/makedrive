/**
 * An extended Filer FileSystem with wrapped methods
 * for writing that manage file metadata (xattribs)
 * reflecting sync state.
 */

var Filer = require('../../lib/filer.js');
var Shell = require('../../lib/filer-shell.js');
var fsUtils = require('../../lib/fs-utils.js');
var conflict = require('../../lib/conflict.js');
var constants = require('../../lib/constants.js');
var resolvePath = require('../../lib/sync-path-resolver.js').resolve;

function SyncFileSystem(fs) {
  var self = this;
  var pathToSync;
  // Manage path resolution for sync path
  Object.defineProperty(self, 'pathToSync', {
    get: function() { return pathToSync; },
    set: function(path) {
      if(path) {
        pathToSync = resolvePath(pathToSync, path);
      } else {
        pathToSync = null;
      }
    }
  });

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

       // Check to see if it is a path or an open file descriptor
       // TODO: Deal with a case of fs.open for a path with a write flag
       // https://github.com/mozilla/makedrive/issues/210
       if(!fs.openFiles[pathOrFD]) {
        self.pathToSync = pathOrFD;
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

  // Expose fs.Shell() but use wrapped sync filesystem instance vs fs.
  // This is a bit brittle, but since Filer doesn't expose the Shell()
  // directly, we deal with it by doing a deep require into Filer's code
  // ourselves. The other down side of this is that we're now including
  // the Shell code twice (once in filer.js, once here). We need to
  // optimize this when we look at making MakeDrive smaller.
  self.Shell = function(options) {
    return new Shell(self, options);
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
