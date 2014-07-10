var expect = require('chai').expect;
var request = require('request');

describe('[HTTP route tests]', function() {
  it('should allow CORS access to /api/sync route', function(done) {
    request.get('http://localhost:9090/api/sync', function(req, res, body) {
      expect(res.headers['access-control-allow-origin']).to.be.eql('*');
      done();
    });
  });
});
