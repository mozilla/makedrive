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
console.log('/mocklogin route', req.param('username'));
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

function getConnectionID(options, callback){
  if(!(options && options.jar)) {
    throw('Expected options.jar');
  }

  var headers = {
   'Accept-Encoding': 'zlib',
   'Content-Type': 'text/event-stream'
  };
  var stream = request({
    url: serverURL + '/api/sync/updates',
    jar: options.jar,
    headers: headers
  });
  var callbackCalled = false;

  var data = '';
  stream.on('data', function(chunk) {
    if(callbackCalled) {
      return;
    }

    data += chunk;

    // Look for something like data: {"syncId":"91842458-d5f7-486f-9297-52e460c3ab38"}
    var match = /data: {"syncId"\s*:\s*"(\w{8}(-\w{4}){3}-\w{12}?)"}/.exec(data);
    if(match) {
      callbackCalled = true;
      callback(null, {
        close: function() {
          stream && stream.end();
        },
        syncId: match[1]
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
    options = {};
  }

console.log('options', options);

  options.jar = options.jar || jar();
  options.username = options.username || uniqueUsername();

console.log('options.jar');
console.dir(options.jar);

  request.post({
    url: serverURL + '/mocklogin/' + options.username,
    jar: options.jar
  }, function(err, res, body) {
    if(err) {
      return callback(err);
    }

    expect(res.statusCode).to.equal(200);
    callback(null, options);
  });
}

function authenticateAndConnect(options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

console.log('authenticateAndConnect Options', options);

  options.jar = options.jar || jar();

  authenticate(options, function(err, result) {
    if(err) {
      return callback(err);
    }
    var username = result.username;

console.log('getConnectionId Options', options);

    getConnectionID(options, function(err, result){
      if(err) {
        return callback(err);
      }

      result.jar = options.jar;
      result.username = username;
      result.done = function() {
        result.close();
        console.log('calling done', !!options.done);
        options.done && options.done();
      };

      callback(null, result);
    });
  });
}

function syncRouteConnect(options, callback){
  if(!(options && options.jar && options.syncId && callback)) {
    throw('You must pass options, options.jar, options.syncId and callback');
  }

console.log('syncRouteConnect Options', options);

  request.get({
    url: serverURL + '/api/sync/' + options.syncId,
    jar: options.jar
  }, function(err, res, body) {
    if(err) {
      return callback(err);
    }

    options.statusCode = res.statusCode;
    callback(null, options);
  });
}

function sourceRouteConnect(options, extras, callback){
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  if(typeof extras === 'function') {
    callback = extras;
    extras = {};
  }

  extras.url = serverURL + '/api/sync/' + options.syncId + '/sources';
  extras.jar =  options.jar;

  request.post(extras, function(err, res, body) {
    if(err) {
      return callback(err);
    }

    options.statusCode = res.statusCode;
    callback(null, options);
  });
}

function csRouteConnect(options, extras, callback){
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  if(typeof extras === 'function') {
    callback = extras;
    extras = {};
  }

  extras.url = serverURL + '/api/sync/' + options.syncId + '/checksums';
  extras.jar =  options.jar;

  request.get(extras, function(err, res, body) {
    if(err) {
      return callback(err);
    }
    options.statusCode = res.statusCode;
    options.body = body;
    callback(null, options);
  });
}

function diffRouteConnect(options, extras, callback){
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  if(typeof extras === 'function') {
    callback = extras;
    extras = {};
  }

  extras.url = serverURL + '/api/sync/' + options.syncId + '/diffs';
  extras.jar =  options.jar;

  request.put(extras, function(err, res, body) {
    if(err) {
      return callback(err);
    }
    options.statusCode = res.statusCode;
    callback(null, options);
  });
}

module.exports = {
  app: app,
  serverURL: serverURL,
  connection: getConnectionID,
  username: uniqueUsername,
  createJar: jar,
  authenticate: authenticate,
  authenticatedConnection: authenticateAndConnect,
  syncRouteConnect: syncRouteConnect,
  sourceRouteConnect: sourceRouteConnect,
  csRouteConnect: csRouteConnect,
  diffRouteConnect: diffRouteConnect
};
