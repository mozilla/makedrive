var request = require('request');
var supertest = require('supertest');
var expect = require('chai').expect;
var app = require('../../server/index.js');

// Mock Webmaker auth
var mockAuthFound = false;
app.routes.post.forEach(function(route) {
  if(route.path === '/mocklogin:username') {
    mockAuthFound = true;
  }
});
if(!mockAuthFound) {
  app.post('/mocklogin/:username', function(req, res) {
    var username = req.param('username');
    if(!username){
      // Expected username.
      res.send(500);
    } else if( req.session && req.session.user && req.session.user.username === username) {
      // Already logged in.
      res.send(401);
    } else{
      // Login worked.
      req.session.user = {username: username};
      res.send(200);
    }
  });
}

var seed = Date.now();
function uniqueUsername() {
  return 'user' + seed++;
}

function getConnectionID(callback){
  var headers = {
   'Accept-Encoding': 'gzip',
   'Content-Type': 'text/event-stream'
  };
  var stream = request({url:'http://localhost:9090/update-stream', 'headers': headers});
  var callbackCalled = false;

  var data = '';
  stream.on('data', function(chunk) {
    if(callbackCalled) {
      return;
    }

    data += chunk;

    // Look for something like data: {"connectionId":"91842458-d5f7-486f-9297-52e460c3ab38"}
    var match = /data: {"connectionId"\s*:\s*"(\w{8}(-\w{4}){3}-\w{12}?)"}/.exec(data);
    if(match) {
      callbackCalled = true;
      callback(null, {
        close: function() {
          stream && stream.end();
        },
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

function createAgent() {
  return supertest.agent(app);
}

function authenticate(options, callback){
  // If no options passed, generate a unique username and agent one
  if(typeof options === 'function') {
    callback = options;
    options = {}
  }

  options.username = options.username || uniqueUsername();
  options.agent = options.agent || createAgent();

  options.agent
    .post('/mocklogin/' + options.username)
    .end(function(err, res) {
      expect(err).not.to.exist;
      expect(res.statusCode).to.equal(200);
      callback(null, options);
    });
}

function authenticateAndConnect(options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  authenticate(options, function(err, result) {
    if(err) {
      return callback(err);
    }
    var agent = result.agent;
    var username = result.username;

    getConnectionID(function(err, result){
      if(err) {
        return callback(err);
      }

      result.agent = agent;
      result.username = username;
      result.done = function() {
        result.close();
        options.done && options.done();
      };

      callback(null, result);
    });
  });
}

module.exports = {
  app: app,
  connection: getConnectionID,
  username: uniqueUsername,
  agent: createAgent,
  authenticate: authenticate,
  authenticatedConnection: authenticateAndConnect
};
