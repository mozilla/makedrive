var request = require('request');
var expect = require('chai').expect;
var app = require('../../server/index.js');
var ws = require('ws');
var filesystem = require('../../server/lib/filesystem.js');

var serverURL = 'http://0.0.0.0:9090',
    socketURL = serverURL.replace( 'http', 'ws' );

var mockAuthFound = false;
var uploadFound = false;
app.routes.post.forEach(function(route) {
  if(route.path === '/mocklogin:username') {
    mockAuthFound = true;
  } else if (route.path === '/upload/*') {
    uploadFound = true;
  }
});

// Mock Webmaker auth
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
// Mock File Upload into Filer FileSystem.  URLs will look like this:
// /upload/:username/:path (where :path will contain /s)
if(!uploadFound) {
  app.post('/upload/*', function(req, res) {
    var parts = req.path.split('/');
    var username = parts[2];
    var path = '/' + parts.slice(3).join('/');

    var fileData = [];
    req.on('data', function(chunk) {
      fileData.push(new Buffer(chunk));
    });
    req.on('end', function() {
      fileData = Buffer.concat(fileData);

      var fs = filesystem.create({
        keyPrefix: username,
        name: username
      });

      // XXXhumph: this hack is just here until we switch Filer to Buffers
      fileData = new Uint8Array(fileData.toJSON());

      fs.writeFile(path, fileData, function(err, data) {
        if(err) {
          res.send(500, {error: err});
          return;
        }

        res.send(200);
      });

    });
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
          // HTML5 provides an easy way to
          // close SSE connections, but this doesn't
          // exist in NodeJS, so force it.
          stream.req.abort();
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

  options.jar = options.jar || jar();
  options.username = options.username || uniqueUsername();

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

  options.jar = options.jar || jar();

  authenticate(options, function(err, result) {
    if(err) {
      return callback(err);
    }
    var username = result.username;

    getConnectionID(options, function(err, result){
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

function syncRouteConnect(options, callback){
  if(!(options && options.jar && options.syncId && callback)) {
    throw('You must pass options, options.jar, options.syncId and callback');
  }

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

function openSocket( options ) {
  var socket = new ws(socketURL);

  function defaultHandler(msg, failout) {
    failout = failout || true;
    return function() {
      console.error("Unexpected socket on " + msg);
      expect(failout).to.be.false;
    };
  }

  var onMessage = options.onMessage || defaultHandler("message");
  var onError = options.onError || defaultHandler("error");
  var onOpen = options.onOpen || defaultHandler("open");
  var onClose = options.onClose || defaultHandler("close");

  socket.on("message", onMessage);
  socket.on("error", onError);
  socket.on("open", onOpen);
  socket.on("close", onClose);

  return {
    socket: socket,
    onClose: onClose
  };
}

// Expects 1 parameter, with each subsequent one being an object
// containing a socket and an onClose callback to be deregistered
function cleanupSockets(done) {
  var sockets = Array.prototype.slice.call(arguments, 1);
  sockets.forEach(function(socketPackage) {
    var socket = socketPackage.socket;

    socket.removeListener('close', socketPackage.onClose);
    socket.close();
  });
  done();
}

function upload(username, path, contents, callback) {
  request.post({
    url: serverURL + '/upload/' + username + path,
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    body: contents
  }, function(err, res, body) {
    expect(err).not.to.exist;
    expect(res.statusCode).to.equal(200);
    callback();
  });
}

module.exports = {
  app: app,
  serverURL: serverURL,
  socketURL: socketURL,
  connection: getConnectionID,
  username: uniqueUsername,
  createJar: jar,
  authenticate: authenticate,
  authenticatedConnection: authenticateAndConnect,
  syncRouteConnect: syncRouteConnect,
  sourceRouteConnect: sourceRouteConnect,
  csRouteConnect: csRouteConnect,
  diffRouteConnect: diffRouteConnect,
  openSocket: openSocket,
  upload: upload,
  cleanupSockets: cleanupSockets
};
