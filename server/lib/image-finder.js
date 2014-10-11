var mime = require('mime');
var Path = require('path');
var filesystem = require('./filesystem.js');

function getContent(data, currentPath) {
  var list = [];
  data.forEach(function(content, index) {
    if (content.type === 'DIRECTORY' && content.contents) {
      list = list.concat(getContent(content.contents, Path.join(currentPath, content.path)));
    }
    if (content.type !== 'DIRECTORY' &&
        mime.lookup(Path.join(currentPath, content.path)).indexOf('image') !== -1) {
      list.push(Path.join('/p', currentPath, content.path));
    }
  });
  return list;
}

function ImageFinder(username) {
  this.fs = filesystem.create({
    keyPrefix: username,
    name: username
  });
}

ImageFinder.prototype.find = function(callback) {
  this.fs.Shell().ls('/', { recursive: true }, function(err, entries) {
    if(err) {
      return callback(err);
    }
    callback(null, getContent(entries, '/'));
  });
};

module.exports = ImageFinder;
