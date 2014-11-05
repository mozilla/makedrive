/**
 * A Default Handler for file content. Does what you expect
 * a web server to do: serves web content for browsers (e.g., as HTML).
 */
var mime = require('mime');
var Path = require('../../../lib/filer.js').Path;
var version = require('../../../package.json').version;
var util = require('./util.js');
var log = require('../logger.js');

function write(content, contentType, res, status) {
  status = status || 200;
  res.header({'Content-Type': contentType});
  res.send(status, content);
}

/**
 * Send an Apache-style 404
 */
function handle404(url, res) {
  util.standard404(url, res);
}

/**
 * Send the raw file, making it somewhat more readable
 */
function handleFile(fs, path, res) {
  var contentType = mime.lookup(path);
  var encoding = mime.charsets.lookup(contentType) === "UTF-8" ? "utf8" : null;

  fs.readFile(path, {encoding: encoding}, function(err, data) {
    if(err) {
      log.error(err, 'Unable to read file path `%s`', path);
      handle404(path, res);
      return;
    }

    write(data, contentType, res);
  });
}

/**
 * Send an Apache-style directory listing
 */
function handleDir(fs, path, res) {
  var sh = new fs.Shell();
  var parent = Path.dirname(path);

  var header = '<!DOCTYPE html>' +
        '<html><head><title>Index of ' + path + '</title></head>' +
        '<body><h1>Index of ' + path + '</h1>' +
        '<table><tr><th><img src="/icons/blank.png" alt="[ICO]"></th>' +
        '<th><a href="#">Name</a></th><th><a href="#">Last modified</a></th>' +
        '<th><a href="#">Size</a></th><th><a href="#">Description</a></th></tr>' +
        '<tr><th colspan="5"><hr></th></tr>' +
        '<tr><td valign="top"><img src="/icons/back.png" alt="[DIR]"></td>' +
        '<td><a href="' + parent + '">Parent Directory</a> </td><td>&nbsp;</td>' +
        '<td align="right"> - </td><td>&nbsp;</td></tr>';

  var footer = '<tr><th colspan="5"><hr></th></tr>' +
        '</table><address>MakeDrive/' + version + ' (Web)</address>' +
        '</body></html>';

  function row(icon, alt, href, name, modified, size) {
    icon = icon || '/icons/unknown.png';
    alt = alt || '[ ]';
    modified = util.formatDate(new Date(modified));
    size = util.formatSize(size);

    return '<tr><td valign="top"><img src="' + icon + '" alt="' + alt + '"></td><td>' +
      '<a href="' + href + '">' + name + '</a> </td>' +
      '<td align="right">' + modified + ' </td>' +
      '<td align="right">' + size + '</td><td>&nbsp;</td></tr>';
  }

  function processEntries(entries) {
    var rows = '';
    entries.forEach(function(entry) {
      var name = Path.basename(entry.path);
      var ext = Path.extname(entry.path);
      var href = Path.join('/p', path, entry.path);
      var icon;
      var alt;

      if(entry.type === 'DIRECTORY') {
        icon = '/icons/folder.png';
        alt = '[DIR]';
      } else { // file
        if(util.isImage(ext)) {
          icon = '/icons/image2.png';
          alt = '[IMG]';
        } else if(util.isMedia(ext)) {
          icon = '/icons/movie.png';
          alt = '[MOV]';
        } else {
          icon = '/icons/text.png';
          alt = '[TXT]';
        }
      }
      rows += row(icon, alt, href, name, entry.modified, entry.size);
    });

    var content = header + rows + footer;
    write(content, 'text/html', res);
  }

  sh.ls(path, function(err, list) {
    if(err) {
      log.error(err, 'Unable to get listing for path `%s`', path);
      handle404(path, res);
      return;
    }
    processEntries(list);
  });
}

function DefaultHandler(fs, res) {
  this.fs = fs;
  this.res = res;
}

DefaultHandler.prototype.handle404 = function(path) {
  handle404(path, this.res);
};

DefaultHandler.prototype.handleDir = function(path) {
  handleDir(this.fs, path, this.res);
};

DefaultHandler.prototype.handleFile = function(path) {
  handleFile(this.fs, path, this.res);
};

module.exports = DefaultHandler;
