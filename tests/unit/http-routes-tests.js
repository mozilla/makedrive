var expect = require('chai').expect;
var request = require('request');
var util = require('../lib/util');
var env = require('../../server/lib/environment');
var ALLOW_DOMAINS = process.env.ALLOWED_CORS_DOMAINS || env.get("ALLOWED_CORS_DOMAINS");

describe('[HTTP route tests]', function() {
  it('should allow CORS access to /api/sync route', function(done) {
    request.get('http://localhost:9090/api/sync', function(req, res, body) {
      expect(res.headers['access-control-allow-origin']).to.be.eql(ALLOW_DOMAINS);
      done();
    });
  });
  it('/p/ should return a 404 error page if the path is not recognized', function(done) {
    util.authenticate(function(err, result) {
      expect(err).not.to.exist;
      expect(result.jar).to.exist;

      request.get({
        url: util.serverURL + '/p/no/file/here.html',
        jar: result.jar
      }, function(err, res, body) {
        expect(err).not.to.exist;
        expect(res.statusCode).to.equal(404);
        expect(body).to.match(/<title>404 Not Found<\/title>/);
        expect(body).to.match(/The requested URL \/no\/file\/here.html was not found on this server./);
        done();
      });
    });
  });
});
