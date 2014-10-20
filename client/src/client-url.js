function parse(url) { return new global.URL(url); }
function format(urlObj) { return urlObj.href; }

module.exports = {
  parse: parse,
  format: format
};
