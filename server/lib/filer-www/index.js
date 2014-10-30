/**
 * A static web server on top of a Filer file system.
 */

var filesystem = require('../filesystem.js');
var log = require('../logger.js');
var DefaultHandler = require('./default-handler.js');
var JSONHandler = require('./json-handler.js');
var RawHandler = require('./raw-handler.js');
var ZIPHandler = require('./zip-handler.js');

function FilerWebServer(username, res, options) {
  options = options || {};

  var fs = this.fs = filesystem.create(username);

  // Pick the appropriate handler type to create
  if(options.json) {
    this.handler = new JSONHandler(fs, res);
  } else if(options.raw) {
    this.handler = new RawHandler(fs, res);
  } else if(options.zip) {
    this.handler = new ZIPHandler(fs, res);
  } else {
    this.handler = new DefaultHandler(fs, res);
  }
}

/**
 * Main entry-point for handling a path request.
 * Each call should use a separate res object, since
 * it will write headers + body.
 */
FilerWebServer.prototype.handle = function(path, res) {
  var fs = this.fs;
  var handler = this.handler;

  fs.stat(path, function(err, stats) {
    if(err) {
      log.error(err, 'Unable to stat path `%s`', path);
      handler.handle404(path, res);
      return;
    }

    // If this is a dir, show a dir listing
    if(stats.isDirectory()) {
      handler.handleDir(path, res);
      return;
    }

    handler.handleFile(path, res);
  });
};

module.exports = FilerWebServer;
