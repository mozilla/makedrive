var rsyncUtils = require('./rsync-utils');
var async = require('../async-lite');

// Generate checksums for every source node in a given destination path
module.exports = function checksums(fs, path, srcList, options, callback) {
  callback = rsyncUtils.findCallback(callback, options);

  var paramError = rsyncUtils.validateParams(fs, path);
  if(paramError) {
    return callback(paramError);
  }

  options = rsyncUtils.configureOptions(options);

  var checksumList = [];

  function ChecksumNode(path, type) {
    this.path = path;
    this.type = type;
  }

  function checksumsForFile(checksumNode, sourceNode, callback) {

    function generateChecksumsForFile() {
      rsyncUtils.checksum(fs, sourceNode.path, options.size, function(err, checksums) {
        if(err) {
          return callback(err);
        }

        checksumNode.checksums = checksums;
        checksumNode.modified = sourceNode.modified;
        checksumList.push(checksumNode);
        
        callback();
      });
    }

    // Checksums are always calculated even for identical files
    // if and only if checksums are turned on and rsync is not
    // implemented recursively
    if(options.checksum && !options.recursive) {
      return generateChecksumsForFile();
    }

    // Skip identical files if checksums are turned off or
    // if rsync is performed recursively
    fs.stat(sourceNode.path, function(err, stat) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      // Add the 'identical' flag if the modified time and size
      // of the existing file match
      if(stat && stat.mtime === sourceNode.modified && stat.size === sourceNode.size) {
        checksumNode.checksums = [];
        checksumNode.modified = sourceNode.modified;
        checksumNode.identical = true;
        checksumList.push(checksumNode);
        
        return callback();
      }

      generateChecksumsForFile();
    });
  }

  function checksumsForLink(checksumNode, sourceNode, callback) {

    function generateChecksumsForLink() {
      fs.readlink(sourceNode.path, function(err, linkContents) {
        if(err) {
          return callback(err);
        }

        rsyncUtils.checksum(fs, linkContents, options.size, function(err, checksums) {
          if(err) {
            return callback(err);
          }

          checksumNode.checksums = checksums;
          checksumList.push(checksumNode);
          
          callback();
        });
      });
    }

    // Checksums are always calculated even for identical links
    // if and only if checksums are turned on and rsync is not
    // implemented recursively
    if(options.checksum && !options.recursive) {
      checksumList.push(checksumNode);
      
      return callback();
    }

    // Skip identical links if checksums are turned off or
    // if rsync is performed recursively
    fs.stat(sourceNode.path, function(err, stat) {
      if(err && err.code !== 'ENOENT') {
        return callback(err);
      }

      // Add `identical` if the modified time and size of the existing file match
      if(stat && stat.mtime === sourceNode.modified && stat.size === sourceNode.size) {
        checksumNode.identical = true;
        checksumList.push(checksumNode);
        
        return callback();
      } 

      // Link does not exist i.e. no checksums
      if(err && err.code === 'ENOENT') {
        checksumList.push(checksumNode);
        
        return callback();
      }

      // Link exists and is not identical to the source link
      generateChecksumsForLink();
    });
  }

  function checksumsForDir(checksumNode, callback) {
    checksumNode.checksums = [];
    checksumList.push(checksumNode);

    callback();
  }

  function getChecksumsForSourceNode(sourceNode, callback) {
    var sourceNodeType = sourceNode.type;
    var checksumNode = new ChecksumNode(sourceNode.path, sourceNodeType);

    // Directory
    if(sourceNodeType === 'DIRECTORY') {
      return checksumsForDir(checksumNode, callback);
    }

    // Link
    if(sourceNodeType === 'SYMLINK' && options.link){
      checksumNode.link = true;
      
      return checksumsForLink(checksumNode, sourceNode, callback);
    }

    // File or Links treated as files
    checksumsForFile(checksumNode, sourceNode, callback);
  }

  async.eachSeries(srcList, getChecksumsForSourceNode, function(err) {
    if(err) {
      callback(err);
    } else {
      callback(null, checksumList);
    }
  });
};
