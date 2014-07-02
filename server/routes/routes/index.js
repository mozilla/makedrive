var env = require('../../lib/environment'),
    version = require('../../../package.json').version,
    FilerWebServer = require('../../lib/filer-www.js'),
    websocketAuth = require('../../lib/websocket-auth');

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
  },
  generateToken: function( req, res ) {
    res.json(200, websocketAuth.generateTokenForSession(req.params.username, req.params.sessionId));
  }
};
