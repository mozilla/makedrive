var Errors = require('../filer').Errors;
var rsyncUtils = require('./rsync-utils');
var async = require('../async-lite');

// Generate diffs from the source based on destination checksums
module.exports = function diff(fs, path, checksumList, options, callback) {
  callback = rsyncUtils.findCallback(callback, options);

  var paramError = rsyncUtils.validateParams(fs, path);
  if(paramError) {
    return callback(paramError);
  }

  options = rsyncUtils.configureOptions(options);

  if(options.checksum && !checksumList) {
    return callback(new Errors.EINVAL('Checksums must be provided'));
  }

  var diffList = [];

  function DiffNode(path, type, modifiedTime) {
    this.path = path;
    this.type = type;
    this.modified = modifiedTime;
  }

  // Compute the checksum for the file/link and
  // append it to the diffNode.
  function appendChecksum(diffNode, diffPath, callback) {
    rsyncUtils.getChecksum(fs, diffPath, function(err, checksum) {
      if(err) {
        return callback(err);
      }

      diffNode.checksum = checksum;
      diffList.push(diffNode);

      callback(null, diffList);
    });
  }

  function diffsForLink(checksumNode, callback) {
    var checksumNodePath = checksumNode.path;
    var diffNode = new DiffNode(checksumNodePath, checksumNode.type, checksumNode.modified);

    fs.readlink(checksumNodePath, function(err, linkContents) {
      if(err) {
        return callback(err);
      }

      diffNode.link = linkContents;

      // If links are enabled, contents of the node pointed
      // to by the link are ignored
      if(options.links) {
        diffList.push(diffNode);

        return callback(null, diffList);
      }

      // If links are disabled, diffs are generated for
      // the node pointed to by the link
      fs.readFile(linkContents, function(err, data) {
        if(err) {
          return callback(err);
        }

        diffNode.diffs = rsyncUtils.rollData(data, checksumNode.checksums, options.size);

        // If versions are enabled, add the checksum
        // field to the diffNode for version comparison
        if(options.versions) {
          return appendChecksum(diffNode, linkContents, callback);
        }

        diffList.push(diffNode);

        callback(null, diffList);
      });
    });
  }

  function diffsForFile(checksumNode, callback) {
    var checksumNodePath = checksumNode.path;
    var diffNode = new DiffNode(checksumNodePath, checksumNode.type, checksumNode.modified);

    // Identical files have empty diffs
    if(checksumNode.identical) {
      diffNode.diffs = [];
      diffList.push(diffNode);

      return callback(null, diffList);
    }

    fs.readFile(checksumNodePath, function(err, data) {
      if (err) {
        return callback(err);
      }

      diffNode.diffs = rsyncUtils.rollData(data, checksumNode.checksums, options.size);

      // If versions are enabled, add the checksum
      // field to the diffNode for version comparison
      if(options.versions) {
        return appendChecksum(diffNode, checksumNodePath, callback);
      }
      diffList.push(diffNode);

      callback(null, diffList);
    });
  }

  function diffsForDir() {

    function processDirContents(checksumNode, callback) {
      var checksumNodePath = checksumNode.path;
      var diffNode = new DiffNode(checksumNodePath, checksumNode.type);

      // Directory
      if(checksumNode.type === 'DIRECTORY') {
        diffNode.diffs = [];

        if(options.recursive) {
          diffList.push(diffNode);
          return callback();
        }

        // If syncing is not done recursively, determine
        // the number of nodes in the directory to indicate
        // that that many nodes still need to be synced
        return fs.readdir(checksumNodePath, function(err, entries) {
          if(err) {
            return callback(err);
          }

          diffNode.nodeList = entries || [];
          diffList.push(diffNode);

          return callback();
        });
      }

      // Link
      if (checksumNode.link) {
        return diffsForLink(checksumNode, callback);
      }

      // File
      diffsForFile(checksumNode, callback);
    }

    async.eachSeries(checksumList, processDirContents, function(err) {
      if(err) {
        return callback(err);
      }

      callback(null, diffList);
    });
  }

  // If there are no checksums to calculate diffs for, bail
  if(!checksumList.length) {
    return callback(null, diffList);
  }

  fs.lstat(path, function(err, stat) {
    if(err) {
      return callback(err);
    }

    // Directory
    if(stat.isDirectory()) {
      return diffsForDir();
    }

    // If the path was a file, clearly there was only one checksum
    // entry i.e. the length of checksumList will be 1 which will
    // be stored in checksumList[0]
    var checksumNode = checksumList[0];

    // File
    if(stat.isFile() || !options.links) {
      return diffsForFile(checksumNode, callback);
    }

    // Link
    diffsForLink(checksumNode, callback);
  });
};
