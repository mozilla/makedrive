// XXXhumph: NOTE that the code below is basically pseudo-code atm.
// We have to figure out how to deal with binary vs. json data,
// file uploads, etc.

var version = require( "../package" ).version;
var S3Provider = require("filer-s3");
var Filer = require("filer");
var mime = require("mime");

function getFileInfo(path) {
  return {
    mime: mime.lookup(path),
    encoding: mime.charsets.lookup(mime.lookup(path)) || null
  }
}

module.exports = {

  index: function( req, res ) {
    res.send( "MakeDrive: https://wiki.mozilla.org/Webmaker/MakeDrive" );
  },
  get: function( req, res ) {
    var user = req.session.user;
    var path = req.params[0];
    var info = getFileInfo(path);

    var fs = new Filer.FileSystem({provider: new S3Provider({keyPrefix: user.username, name: user.username, bucket: "<name>", key: "<key>", secret: "<secret>"})});
    fs.readFile("/" + path, info.encoding, function(err, data) {
      if(err) {
        if(err.code === "ENOENT") {
          res.send(404);
          return;
        } else {
          res.send(500, "Unable to read file" + err);
        }
      }
      res.writeHead(200, "OK", {'Content-Type': info.mime});
      res.write(data);
      res.end()
    });
  },
  healthcheck: function( req, res ) {
    res.json({
      http: "okay",
      version: version
    });
  },
  clear: function(req, res) {
    var user = req.session.user;
    var fs = new Filer.FileSystem({flags: "FORMAT", provider: new S3Provider({keyPrefix: "dave", name: "dave", bucket: "<name>", key: "<key>", secret: "<secret>"})}, function(err){
      if(err) {
        res.send(500, {error: e});
        return;
      }
      res.send(200);

    });
  },
};
