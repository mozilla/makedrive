var request = require('request'),
    uuid = require("node-uuid"),
    expect = require('chai').expect,
    util = require('../lib/util.js'),
    data = {};

beforeEach(function(){
  data = {
    json: {
      path: '/mmmhm',
      srcList: [{path: '/alright'}]
    }
  };
})

describe('/api/sync route', function () {
  it('should return a 200 status code after trying to access the /api/sync route', function (done){
    util.authenticatedConnection({done: done}, function(err, result) {
      expect(err).not.to.exist;
      request.get({
        url: util.serverURL + '/api/sync/' + result.syncId,
        jar: result.jar
      }, function(err, res, body) {
        expect(err).not.to.exist;
        expect(res.statusCode).to.equal(200);
        result.done();
      });
    });
  });
  it('should return a 423 status code when trying to initiate more than 1 sync simultaneously with the same user logged in', function (done){
    util.authenticatedConnection({done: done}, function(err, result1) {
      expect(err).not.to.exist;
      util.syncRouteConnect(result1, function(err, result2){
        expect(err).not.to.exist;
        util.syncRouteConnect(result2, function(err, result3){
          expect(err).not.to.exist;
          expect(result2.statusCode).to.equal(423);
          result3.done();
        })
      });
    });
  });
  it('should return a 400 status code when finding a mismatching syncId attached to the current user', function (done){
    util.authenticatedConnection({done: done}, function(err, result1) {
      expect(err).not.to.exist;
      result1.syncId = uuid.v4();
      util.syncRouteConnect(result1, function(err, result2){
        expect(err).not.to.exist;
        expect(result2.statusCode).to.equal(400);
        result2.done();
      });
    });
  });
  // Can we test against sync.start's fatal mkdir error/500 statusCode?
});

describe('/api/sync/:syncId/sources route', function () {
  it('should return a 400 status code if request.body is empty', function (done){
    util.authenticatedConnection({done: done}, function(err, result1) {
      expect(err).not.to.exist;
        util.syncRouteConnect(result1, function(err, result2) {
          expect(err).not.to.exist;
          var localData = data;
          localData.json = {};
          util.sourceRouteConnect(result2, localData, function(err, result3) {
            expect(err).not.to.exist;
            expect(result3.statusCode).to.equal(400);
            result3.done();
          });
      });
    });
  });
  it('should return a 400 when path is missing from request.body', function (done){
    util.authenticatedConnection({done: done}, function(err, result1) {
      expect(err).not.to.exist;
        util.syncRouteConnect(result1, function(err, result2) {
          expect(err).not.to.exist;
          var localData = data;
          localData.json.path = undefined;
          util.sourceRouteConnect(result2, localData, function(err, result3) {
            expect(err).not.to.exist;
            expect(result3.statusCode).to.equal(400);
            result3.done();
          });
      });
    });
  });
  it('should return a 400 when the srcList is missing from request.body', function (done){
    util.authenticatedConnection({done: done}, function(err, result1) {
      expect(err).not.to.exist;
        util.syncRouteConnect(result1, function(err, result2) {
          expect(err).not.to.exist;
          var localData = data;
          localData.json.srcList = undefined;
          util.sourceRouteConnect(result2, localData, function(err, result3) {
            expect(err).not.to.exist;
            expect(result3.statusCode).to.equal(400);
            result3.done();
          });
      });
    });
  });
  it('should return a 201 when sync successfully retrieves path and srcList', function (done){
    util.authenticatedConnection({done: done}, function(err, result1) {
      expect(err).not.to.exist;
        util.syncRouteConnect(result1, function(err, result2) {
          expect(err).not.to.exist;
          util.sourceRouteConnect(result2, data, function(err, result3) {
            expect(err).not.to.exist;
            expect(result3.statusCode).to.equal(201);
            result3.done();
          });
      });
    });
  });
});

describe('/api/sync/:syncId/checksums', function () {
  it('should return a 200 status code and the checksums after the sync validates', function (done){
    util.authenticatedConnection({done: done}, function(err, result1) {
      expect(err).not.to.exist;
      util.syncRouteConnect(result1, function(err, result2) {
        expect(err).not.to.exist;
        util.sourceRouteConnect(result2, data, function(err, result3) {
          expect(err).not.to.exist;
          util.csRouteConnect(result3, function(err, result4) {
            expect(err).not.to.exist;
            expect(result4.body.checksums.length).to.be.above(0);
            expect(result4.statusCode).to.equal(200);
            result4.done();
          });
        });
      });
    });
  });
});

describe('/healthcheck', function () {
  it('should return a 200 status code, an okay message, and the version if the healthcheck clears', function (done){
    util.authenticatedConnection({done: done}, function(err, result) {
      expect(err).not.to.exist;
      request.get({
        url: util.serverURL + '/healthcheck',
        jar: result.jar,
        json: true
      }, function(err, res, body) {
        expect(err).not.to.exist;
        expect(res.body.http).to.deep.equal('okay');
        expect(res.body.version).to.exist;
        expect(res.statusCode).to.equal(200);
        result.done();
      });
    });
  });
});
