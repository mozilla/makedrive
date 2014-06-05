var env = require('../../lib/environment'),
    filesystem = require('../../lib/filesystem'),
    version = require('../../../package.json').version,
    mime = require('mime');


function getFileInfo(path) {
  return {
    mime: mime.lookup(path),
    encoding: mime.charsets.lookup(mime.lookup(path)) === "UTF-8" ? "utf8" : null
  };
}

module.exports = {
  // TODO: Factor this object into separate files as needed

  index: function( req, res ) {
    res.send( "MakeDrive: https://wiki.mozilla.org/Webmaker/MakeDrive" );
  },
  retrieveFiles: function( req, res ) {
    var username = req.params.username;
    var path = req.params[0];
    var info = getFileInfo(path);

    var fs = filesystem.create({
        keyPrefix: username,
        name: username
    });

    fs.readFile("/" + path, info.encoding, function(err, data) {
      if(err) {
        if(err.code === "ENOENT") {
          res.send(404);
          return;
        } else {
          res.send(500, "Unable to read file" + err);
        }
      }
      res.header({'Content-Type': info.mime});
      res.send(200, data);
    });
  },
  healthcheck: function( req, res ) {
    res.json({
      http: "okay",
      version: version
    });
  }
};
