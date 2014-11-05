module.exports = function(fs, zipfile, options, callback) {
  var Filer = require('../../lib/filer.js');
  var Path = Filer.Path;
  var JSZip = require('jszip');
  var async = require('async');
  var sh = new fs.Shell();
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  callback = callback || function(){};

  if(!zipfile) {
    callback(new Filer.Errors.EINVAL('Missing zipfile argument'));
    return;
  }

  var path = Path.resolve(sh.pwd(), zipfile);
  var destination = Path.resolve(options.destination || sh.pwd());

  fs.readFile(path, function(err, data) {
    if(err) return callback(err);

    var zip = new JSZip(data);
    var filenames = [];
    zip.filter(function(relPath, file) {
      var isDir = file.options.dir;
      var data = isDir ? null : file.asNodeBuffer();

      filenames.push({
        absPath: Path.join(destination, file.name),
        isDirectory: isDir,
        data: data
      });
    });

    function decompress(path, callback) {
      if(path.isDirectory) {
        sh.mkdirp(path.absPath, callback);
      } else {
        fs.writeFile(path.absPath, path.data, callback);
      }
    }

    async.eachSeries(filenames, decompress, callback);
  });
};
