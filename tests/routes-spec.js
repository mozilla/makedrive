var request = require('supertest'),
    expect = require('chai').expect,
    express = require('express'),
    app;

function getConnectionID(callback){
  var http = require('request');

  var headers = {
   'Accept-Encoding': 'gzip',
   'Content-Type': 'text/event-stream'
  };
  var stream = http({url:'http://localhost:9090/update-stream', 'headers': headers});
  var callbackCalled = false;

  var data = '';
  stream.on('data', function(chunk) {
    data += chunk;

    // Look for something like data: {"connectionId":"91842458-d5f7-486f-9297-52e460c3ab38"}
    var match = /data: {"connectionId":"(\w{8}(-\w{4}){3}-\w{12}?)"}/.exec(data);
    if(!callbackCalled && match) {
      callbackCalled = true;
      callback(null, {
        close: function() { stream.end(); },
        connectionID: match[1]
      });
    }
  });
  stream.on('end', function() {
    if(callbackCalled) {
      return;
    }

    callbackCalled = true;
    stream = null;
    callback('Remote hung-up');
  });
}

function authenticate(username, callback){
  var agent = request.agent(app);

  // Bail early if no username specified (simulate no auth)
  if(!username) {
    return callback(null, agent);
  }

  agent
    .post('/mocklogin/' + username)
    .end(function(err, res) {
      expect(err).not.to.exist;
      expect(res.statusCode).to.equal(200);
      callback(null, agent);
    });
}

function setup(username, done, callback) {
  authenticate(username, function(err, agent) {
    if(err) {
      return callback(err);
    }
    getConnectionID(function(err, result){
      if(err) {
        return callback(err);
      }

      result.agent = agent;

      function finishTest() {
        result.close();
        done();
      }
      result.done = finishTest;

      callback(null, result);
    });
  });
}

describe('/api/sync Routes', function () {

  beforeEach(function(){
    app = require('../server/index');
    app.post('/mocklogin/:username', function(req, res) {
      var username = req.param('username');
      if(!username){
        res.send(500);
      }
      else{
        req.session.user = {username: username};
        res.send(200);
      }
    });
  });

  afterEach(function(){
    app._server.close();
    app = null;
  });

  it('should return a 423 status code if second user connectionID is set trying to access the /api/sync route', function (done){
    setup('user1', done, function(err, test1) {
      expect(err).not.to.exist;

      var agent1 = test1.agent;
      var connectionID1 = test1.connectionID;
console.log('connectionID1', connectionID1)

      agent1
      .get('/api/sync/' + connectionID1)
      .end(function (err, res) {
        expect(err).not.to.exist;
        expect(res.status).to.equal(200);
      });

      setup('user1', done, function(err, test2) {
        var agent2 = test2.agent;
        var connectionID2 = test2.connectionID;
console.log('connectionID2', connectionID2)

        agent2
        .get('/api/sync/' + connectionID2)
        .end(function (err, res) {
          expect(err).not.to.exist;
          expect(res.status).to.equal(423);
          test2.done();
        });
      });
    });
  });

  it('should return a 423 status code if second user connectionID is set trying to access the /api/sync route', function (done){
    setup(undefined, done, function(err, test) {
      expect(err).not.to.exist;

      var agent = test.agent;
      var connectionID = test.connectionID;

      agent
      .get('/api/sync/' + connectionID)
      .end(function (err, res) {
        expect(err).not.to.exist;
        expect(res.status).to.equal(400);
        test.done();
      });
    });
  });

  it('should return a 200 status code after trying to access the /api/sync route', function (done){
    setup('baba', done, function(err, test) {
      expect(err).not.to.exist;

      var agent = test.agent;
      var connectionID = test.connectionID;

      agent
      .get('/api/sync/' + connectionID)
      .end(function (err, res) {
        expect(err).not.to.exist;
        expect(res.status).to.equal(200);
        test.done();
      });
    });
  });
});
