var Path = require('../filer').Path;
var async = require('../async-lite');
var conflict = require('../conflict');
var rsyncUtils = require('./rsync-utils');

// Generate the list of paths at the source file system
module.exports = function sourceList(fs, path, options, callback) {
  callback = rsyncUtils.findCallback(callback, options);

  var paramError = rsyncUtils.validateParams(fs, path);
  if(paramError) {
    return callback(paramError);
  }

  options = rsyncUtils.configureOptions(options);

  var sources = [];

  function SourceNode(path, stats) {
    this.path = path;
    this.modified = stats.mtime;
    this.size = stats.size;
    this.type = stats.type;
  }

  // Make sure this isn't a conflicted copy before adding
  // (we don't send these to the server in a sync)
  function addNonConflicted(sourceNode, callback) {
    conflict.isConflictedCopy(fs, sourceNode.path, function(err, conflicted) {
      if(err) {
        return callback(err);
      }

      if(!conflicted) {
        sources.push(sourceNode);
      }

      callback(null, sources);
    });
  }

  function getSrcListForDir(stats) {
    if(options.superficial) {
      sources.push(new SourceNode(path, stats));
      return callback(null, sources);
    }

    fs.readdir(path, function(err, entries) {
      if(err) {
        return callback(err);
      }

      function processDirContents(contentPath, callback) {
        var sourceNodePath = Path.join(path, contentPath);

        fs.lstat(sourceNodePath, function(err, stats) {
          if(err) {
            return callback(err);
          }

          var sourceNode = new SourceNode(sourceNodePath, stats);

          // File or Link or Non-recursive directory
          if(!options.recursive || !stats.isDirectory()) {
            return addNonConflicted(sourceNode, callback);
          }

          // Directory recursively
          sourceList(fs, sourceNodePath, options, function(err, items) {
            if(err) {
              return callback(err);
            }

            sources = sources.concat(items);

            callback();
          });
        });
      }

      // Add the directory to the sources
      sources.push(new SourceNode(path, stats));

      async.eachSeries(entries, processDirContents, function(err) {
        if(err) {
          return callback(err);
        }

        callback(null, sources);
      });
    });
  }

  function getSrcListForFileOrLink(stats) {
    var sourceNode = new SourceNode(path, stats);
    addNonConflicted(sourceNode, callback);
  }

  function getSrcListForPath(path) {
    fs.lstat(path, function(err, stats) {
      if(err) {
        return callback(err);
      }

      // File or Link
      if(!stats.isDirectory()) {
        return getSrcListForFileOrLink(stats);
      }

      // Directory
      getSrcListForDir(stats);
    });
  }

  getSrcListForPath(path);
};
