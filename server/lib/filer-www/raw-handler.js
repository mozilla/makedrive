/**
 * A mix between the Default Handler (for file content as raw binary/utf8)
 * and the JSON Handler (for dir listings as JSON).
 */
var JSONHandler = require('./json-handler.js');
var DefaultHandler = require('./default-handler.js');

function RawHandler(fs, res) {
  this.fs = fs;
  this.res = res;
}

RawHandler.prototype.handle404 = function(path) {
  var jsonHandler = new JSONHandler(this.fs, this.res);
  jsonHandler.handle404(path);
};

RawHandler.prototype.handleDir = function(path) {
  var jsonHandler = new JSONHandler(this.fs, this.res);
  jsonHandler.handleDir(path);
};

RawHandler.prototype.handleFile = function(path) {
  var defaultHandler = new DefaultHandler(this.fs, this.res);
  defaultHandler.handleFile(path);
};

module.exports = RawHandler;
