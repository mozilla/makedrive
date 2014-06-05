module.exports = (function() {
  var habitat = require("habitat");
  habitat.load( require("path").resolve(__dirname, "../../.env"));
  return new habitat();
}());
