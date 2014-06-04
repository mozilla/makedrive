var request = require('supertest');
var expect = require('chai').expect;
var util = require('../lib/util.js');

describe('/api/sync Routes', function () {
  it('should return a 200 status code after trying to access the /api/sync route', function (done){
    util.authenticatedConnection({done: done}, function(err, result) {
      expect(err).not.to.exist;

      var agent = result.agent;
      var connectionID = result.connectionID;

      agent
      .get('/api/sync/' + connectionID)
      .expect(200)
      .end(function (err, res) {
        expect(err).not.to.exist;
        result.done();
      });
    });
  });
});

describe('/api/sync/:syncId/sources route', function () {
  it('should return a 403 when request.body is set to undefined', function (done){
    util.authenticatedConnection({done: done}, function(err, result) {
      expect(err).not.to.exist;

      var agent = result.agent;

      agent
      .post('/api/sync/' + result.connectionID + '/sources')
      .send({ name: 'tj', pet: 'tobi' })
      .expect(403)
      .end(function (err, res) {
        expect(err).not.to.exist;
        result.done();
      });
    });
  });
});
