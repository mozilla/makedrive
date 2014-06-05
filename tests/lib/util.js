var request = require('request');
var expect = require('chai').expect;
var app = require('../../server/index.js');

var serverURL = 'http://0.0.0.0:9090';

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

function getConnectionID(jar, callback){
  var headers = {
   'Accept-Encoding': 'gzip',
   'Content-Type': 'text/event-stream'
  };
  var stream = request({
    url: serverURL + '/api/sync/updates',
    jar: jar,
    headers: headers
  });
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

function jar() {
  return request.jar();
}

function authenticate(options, callback){
  // If no options passed, generate a unique username and jar
  if(typeof options === 'function') {
    callback = options;
    options = {}
  }

  options.jar = options.jar || jar();
  options.username = options.username || uniqueUsername();

  request.post({
    url: serverURL + '/mocklogin/' + options.username,
    jar: options.jar
  }, function(err, res, body) {
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

  options.jar = options.jar || jar();

  authenticate(options, function(err, result) {
    if(err) {
      return callback(err);
    }
    var username = result.username;

    getConnectionID(options.jar, function(err, result){
      if(err) {
        return callback(err);
      }

      result.jar = options.jar;
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
  serverURL: serverURL,
  connection: getConnectionID,
  username: uniqueUsername,
  createJar: jar,
  authenticate: authenticate,
  authenticatedConnection: authenticateAndConnect
};
