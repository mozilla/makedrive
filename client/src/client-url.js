function parse(url) { return new global.URL(url); }
function format(urlObj) { return urlObj.toString(); }

module.exports = {
  parse: parse,
  format: format
};
