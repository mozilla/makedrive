/**
 * A static web server on top of a Filer file system.
 */
var mime = require('mime');
var Path = require('filer').Path;
var filesystem = require('./filesystem.js');
var version = require('../../package.json').version;

function write(content, contentType, res) {
  res.header({'Content-Type': contentType});
  res.send(200, content);
}

/**
 * Send an Apache-style 404
 */
function handle404(url, res) {
  var html = '<!DOCTYPE html>' +
        '<html><head>' +
        '<title>404 Not Found</title>' +
        '</head><body>' +
        '<h1>Not Found</h1>' +
        '<p>The requested URL ' + url + ' was not found on this server.</p>' +
        '<hr>' +
        '<address>MakeDrive/' + version + ' (Web) Server</address>' +
        '</body></html>';
  write(html, 'text/html', res);
}

/**
 * Send the raw file, making it somewhat more readable
 */
function handleFile(fs, path, res) {
  var contentType = mime.lookup(path);
  var encoding = mime.charsets.lookup(contentType) === "UTF-8" ? "utf8" : null;

  fs.readFile(path, {encoding: encoding}, function(err, data) {
    if(err) {
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
  var sh = fs.Shell();
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

  function formatDate(d) {
    // 20-Apr-2004 17:14
    return d.getDay() + '-' +
      d.getMonth() + '-' +
      d.getFullYear() + ' ' +
      d.getHours() + ':' +
      d.getMinutes();
  }

  function formatSize(s) {
    var units = ['', 'K', 'M'];
    if(!s) {
      return '-';
    }
    var i = (Math.floor(Math.log(s) / Math.log(1024)))|0;
    return Math.round(s / Math.pow(1024, i), 2) + units[i];
  }

  function row(icon, alt, href, name, modified, size) {
    icon = icon || '/icons/unknown.png';
    alt = alt || '[ ]';
    modified = formatDate(new Date(modified));
    size = formatSize(size);

    return '<tr><td valign="top"><img src="' + icon + '" alt="' + alt + '"></td><td>' +
      '<a href="' + href + '">' + name + '</a> </td>' +
      '<td align="right">' + modified + ' </td>' +
      '<td align="right">' + size + '</td><td>&nbsp;</td></tr>';
  }

  function isMedia(ext) {
    return ext === '.avi' ||
      ext === '.mpeg' ||
      ext === '.mp4' ||
      ext === '.ogg' ||
      ext === '.webm' ||
      ext === '.mov' ||
      ext === '.qt' ||
      ext === '.divx' ||
      ext === '.wmv' ||
      ext === '.mp3' ||
      ext === '.wav';
  }

  function isImage(ext) {
    return ext === '.png' ||
      ext === '.jpg' ||
      ext === '.jpe' ||
      ext === '.pjpg' ||
      ext === '.jpeg'||
      ext === '.gif' ||
      ext === '.bmp' ||
      ext === '.ico';
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
        if(isImage(ext)) {
          icon = '/icons/image2.png';
          alt = '[IMG]';
        } else if(isMedia(ext)) {
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
      handle404(path, res);
      return;
    }
    processEntries(list);
  });
}


function FilerWebServer(username) {
  this.fs = filesystem.create({
    keyPrefix: username,
    name: username
  });
}

/**
 * Main entry-point for handling a path request.
 * Each call should use a separate res object, since
 * it will write headers + body.
 */
FilerWebServer.prototype.handle = function(path, res) {
  var that = this;
  var fs = that.fs;

  fs.stat(path, function(err, stats) {
    if(err) {
      handle404(path, res);
      return;
    }

    // If this is a dir, show a dir listing
    if(stats.isDirectory()) {
      handleDir(fs, path, res);
      return;
    }

    handleFile(fs, path, res);
  });
};

module.exports = FilerWebServer;
