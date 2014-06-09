var env = require('../../lib/environment'),
    version = require('../../../package.json').version,
    FilerWebServer = require('../../lib/filer-www.js');

module.exports = {
  // TODO: Factor this object into separate files as needed

  index: function( req, res ) {
    res.send( "MakeDrive: https://wiki.mozilla.org/Webmaker/MakeDrive" );
  },
  servePath: function( req, res ) {
    var username = req.params.username;
    var path = '/' + req.params[0];

    var server = new FilerWebServer(username);
    server.handle(path, res);
  },
  healthcheck: function( req, res ) {
    res.json({
      http: "okay",
      version: version
    });
  }
};
