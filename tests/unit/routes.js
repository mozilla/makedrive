var request = require('supertest');
var expect = require('chai').expect;
var util = require('../lib/util.js');

describe('/api/sync Routes', function () {
  it('should return a 200 status code after trying to access the /api/sync route', function (done){
    util.authenticatedConnection({done: done}, function(err, result) {
      expect(err).not.to.exist;

      request.get({
        url: util.serverURL + '/api/sync/' + result.connectionID,
        jar: result.jar
      }, function(err, res, body) {
        expect(err).not.to.exist;
        expect(res.statusCode).to.equal(200);
        result.done();
      });
    });
  });
});

describe('/api/sync/:syncId/sources route', function () {
  it('should return a 403 when request.body is set to undefined', function (done){
    util.authenticatedConnection({done: done}, function(err, result) {
      expect(err).not.to.exist;

      request.get({
        url: util.serverURL + '/api/sync/' + result.connectionID + '/sources',
        jar: result.jar
      }, function(err, res, body) {
        expect(err).not.to.exist;
        expect(res.statusCode).to.equal(403);
        result.done();
      });
      
    });
  });
});
