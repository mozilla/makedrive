/**
 * A JSON Handler, for web APIs vs. browsers to consume
 */
var mime = require('mime');
var log = require('../logger.js');

function write(content, res, status) {
  status = status || 200;
  res.jsonp(status, content);
}

/**
 * Send an Apache-style 404
 */
function handle404(url, res) {
  var json = {
    error: {
      code: 404,
      message: 'The requested URL ' + url + ' was not found on this server.'
    }
  };
  write(json, res, 404);
}

/**
 * Send the raw file
 */
function handleFile(fs, path, res) {
  var contentType = mime.lookup(path);
  var encoding = mime.charsets.lookup(contentType) === "UTF-8" ? "utf8" : null;

  fs.readFile(path, {encoding: encoding}, function(err, data) {
    if(err) {
      log.error(err, 'Unable to read file at path `%s`', path);
      handle404(path, res);
      return;
    }

    // If this is a Buffer, serialize it to a regular array
    if(encoding === null) {
      data = data.toJSON();
    }

    write(data, res);
  });
}

/**
 * Send recursive dir listing
 */
function handleDir(fs, path, res) {
  var sh = new fs.Shell();

  sh.ls(path, {recursive: true}, function(err, listing) {
    if(err) {
      log.error(err, 'Unable to get listing for path `%s`', path);
      handle404(path, res);
      return;
    }
    write(listing, res);
  });
}


function JSONHandler(fs, res) {
  this.fs = fs;
  this.res = res;
}

JSONHandler.prototype.handle404 = function(path) {
  handle404(path, this.res);
};

JSONHandler.prototype.handleDir = function(path) {
  handleDir(this.fs, path, this.res);
};

JSONHandler.prototype.handleFile = function(path) {
  handleFile(this.fs, path, this.res);
};

module.exports = JSONHandler;
