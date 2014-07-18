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

module.exports = {
  formatDate: formatDate,
  formatSize: formatSize,
  isMedia: isMedia,
  isImage: isImage
};
