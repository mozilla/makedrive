var Filer = require('../../lib/filer.js');

function SyncFileSystem(options) {
  var self = this;
  var fs = new Filer.FileSystem(options);

  // The following non-modifying fs operations can be run as normal,
  // and are simply forwarded to the fs instance. NOTE: we have
  // included setting xattributes since we don't sync these to the server.
  ['stat', 'fstat', 'lstat', 'exists', 'readlink', 'realpath',
   'rmdir', 'readdir', 'open', 'close', 'fsync', 'read', 'readFile',
   'setxattr', 'fsetxattr', 'getxattr', 'fgetxattr', 'removexattr',
   'fremovexattr', 'watch'].forEach(function(method) {
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
  ['rename', 'truncate', 'link', 'symlink', 'unlink', 'mknod',
   'mkdir', 'utimes', 'writeFile','ftruncate', 'futimes', 'write',
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

  // Expose fs.Shell()
  self.Shell = function(options) {
    return fs.Shell(options);
  };
}

module.exports = SyncFileSystem;
