/**
 * A ZIP Handler, for exporting filesystem contents.
 * The generated zip archive roots all files/dirs in
 * an export/ folder, and returns export.zip.
 */
var archiver = require('archiver');
var Path = require('../../../lib/filer.js').Path;
var async = require('async');
var util = require('./util.js');

function archivePath(fs, path, res) {
  function fixPath(path) {
    // Make path relative within the zip archive
    return path.replace(/^\//, 'export/');
  }

  function addFile(path, callback) {
    fs.readFile(path, function(err, data) {
      if(err) return callback(err);

      archive.append(data, {name: fixPath(path)});
      callback();
    });
  }

  function addDir(path, callback) {
    fs.readdir(path, function(err, list) {
      if(err) return callback(err);

      // Add the directory itself
      archive.append(null, {name: fixPath(path) + '/'});

      // Add all children of this dir, too
      async.eachSeries(list, function(entry, callback) {
        add(Path.join(path, entry), callback);
      }, callback);
    });
  }

  function add(path, callback) {
    fs.stat(path, function(err, stats) {
      if(err) return callback(err);

      if(stats.isDirectory()) {
        addDir(path, callback);
      } else {
        addFile(path, callback);
      }
    });
  }

  function error() {
    // Signal to the client that things are broken by hanging up.
    // There may be a better way to handle the error case here.
    if(res.socket) {
      res.socket.destroy();
    }
  }

  res.header('Content-Type', 'application/zip');
  res.header('Content-Disposition', 'attachment; filename=export.zip');

  var archive = archiver('zip');
  archive.on('error', error);
  archive.pipe(res);

  add(path, function(err) {
    if(err) {
      error();
    } else {
      archive.finalize();
    }
  });
}


function ZIPHandler(fs, res) {
  this.fs = fs;
  this.res = res;
}

ZIPHandler.prototype.handle404 = function(path) {
  util.standard404(path, this.res);
};

ZIPHandler.prototype.handleDir = function(path) {
  archivePath(this.fs, path, this.res);
};

ZIPHandler.prototype.handleFile = function(path) {
  archivePath(this.fs, path, this.res);
};

module.exports = ZIPHandler;
