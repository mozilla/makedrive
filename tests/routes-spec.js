var request = require('supertest'),
    expect = require('chai').expect,
    express = require('express'),
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

function authenticate(username, callback){
  var agent = request.agent(app);
  agent
    .post('/mocklogin/' + username)
    .end(function(err, res) {
      expect(err).not.to.exist;
      expect(res.statusCode).to.equal(200);
      callback(null, agent);
    });
}

describe('routeAccess', function () {
  it('should return a 200 status code after trying to access the /update-stream route', function (done){
    authenticate('baba', function(err, agent){
      agent
      .get('/update-stream')
      //.timeout(500)
      .end(function (err, res) {
        expect(err).not.to.exist;
        expect(res.statusCode).to.equal(200);
        done();
      });
    });
  })
});
