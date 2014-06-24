var request = require('request');
var expect = require('chai').expect;
var app = require('../../server/index.js');
var ws = require('ws');
var filesystem = require('../../server/lib/filesystem.js');
var SyncMessage = require('../../server/lib/syncmessage');
var rsync = require('../../server/lib/rsync');

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

/**
 * Misc Helpers
 */
function uniqueUsername() {
  return 'user' + seed++;
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

function resolveToJSON(string) {
  try {
    string = JSON.parse(string);
  } catch(e) {
    expect("Parsing of a SyncMessage").to.be.fine;
  }
  return string;
}

function resolveFromJSON(obj) {
  try {
    obj = JSON.stringify(obj);
  } catch(e) {
    expect("Parsing of a SyncMessage").to.be.fine;
  }
  return obj;
}

/**
 * Connection Helpers
 */
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

function getWebsocketToken(options, callback){
  // Fail early and noisily when missing options.jar
  if(!(options && options.jar)) {
    throw('Expected options.jar');
  }

  request({
    url: serverURL + '/api/sync',
    jar: options.jar,
    json: true
  }, function(err, response, body) {
    expect(err, "[Error getting a token: " + err + "]").to.not.exist;
    expect(response.statusCode, "[Error getting a token: " + response.body.message + "]").to.equal(200);

    options.token = body;
    callback(null, options);
  });
}

function authenticate(options, callback){
  // If no options passed, generate a unique username and jar
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  options.jar = options.jar || jar();
  options.username = options.username || uniqueUsername();
  options.logoutUser = function (cb) {
    request({
      url: serverURL + '/logout',
      jar: options.jar,
      json: true,
      method: "POST"
    }, function(err, res, body){
      expect(err, "[Automatic logout of user failed: " + err + "]").to.not.exist;
      expect(res.statusCode, "[Automatic logout of user failed]").to.equal(200);
      expect(body, "[Automatic logout of user failed").to.deep.equal({ status: "okay" });
      cb();
    });
  };

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

    getConnectionID(options, function(err, result1){
      if(err) {
        return callback(err);
      }

      result1.jar = options.jar;
      result1.username = username;
      result1.done = function() {
        options.logoutUser(function() {
          result1.close();
          options.done && options.done();
        });
      };

      getWebsocketToken(result1, function(err, result2) {
        if(err){
          return callback(err);
        }

        callback(null, result2);
      });
    });
  });
}

function jar() {
  return request.jar();
}

/**
 * HTTP Sync Helpers
 */
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
  extras.json = true;

  request.get(extras, function(err, res, body) {
    if(err) {
      return callback(err);
    }
    options.statusCode = res.statusCode;
    options.body = body;
    callback(null, options);
  });
}

/**
 * Socket Helpers
 */
function openSocket(socketData, options) {
  if (typeof options !== "object") {
    if (socketData && !socketData.syncId) {
      options = socketData;
      socketData = null;
    }
  }
  options = options || {};

  var socket = new ws(socketURL);

  function defaultHandler(msg, failout) {
    failout = failout || true;

    return function(code, data) {
      var details = "";

      if (code) {
        details += ": " + code.toString();
      }
      if (data) {
        details += " " + data.toString();
      }

      expect(failout, "[Unexpected socket on" + msg + " event]" + details).to.be.false;
    };
  }

  if (socketData) {
    options.onOpen = function() {
      socket.send(JSON.stringify({
        syncId: socketData.syncId,
        token: socketData.token
      }));
    };
  }

  var onOpen = options.onOpen || defaultHandler("open");
  var onMessage = options.onMessage || defaultHandler("message");
  var onError = options.onError || defaultHandler("error");
  var onClose = options.onClose || defaultHandler("close");

  socket.once("message", onMessage);
  socket.once("error", onError);
  socket.once("open", onOpen);
  socket.once("close", onClose);

  return {
    socket: socket,
    onClose: onClose,
    onMessage: onMessage,
    onError: onError,
    onOpen: onOpen,
    setClose: function(func){
      socket.removeListener("close", onClose);
      socket.once("close", func);

      this.onClose = socket._events.close.listener;
    },
    setMessage: function(func){
      socket.removeListener("message", onMessage);
      socket.once("message", func);

      this.onMessage = socket._events.message.listener;
    },
    setError: function(func){
      socket.removeListener("error", onError);
      socket.once("error", func);

      this.onError = socket._events.error.listener;
    },
    setOpen: function(func){
      socket.removeListener("open", onOpen);
      socket.once("open", func);

      this.onOpen = socket._events.open.listener;
    }
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

/**
 * Sync Helpers
 */
var syncSteps = {
  srcList: function(socketPackage, customAssertions, cb) {
    if (!cb) {
      cb = customAssertions;
      customAssertions = null;
    }

    socketPackage.socket.removeListener("message", socketPackage.onMessage);
    socketPackage.socket.once("message", function(message) {
      // Reattach original listener
      socketPackage.socket.once("message", socketPackage.onMessage);

      message = resolveToJSON(message);
      if (!customAssertions) {
        expect(message).to.exist;
        expect(message.type).to.equal(SyncMessage.RESPONSE);
        expect(message.name, "[SyncMessage Type error. SyncMessage.content was: " + message.content + "]").to.equal(SyncMessage.SOURCE_LIST);
        expect(message.content).to.exist;
        expect(message.content.srcList).to.exist;
        expect(message.content.path).to.exist;

        return cb({
          srcList: message.content.srcList,
          path: message.content.path
        });
      }

      customAssertions(message, cb);
    });

    var srcListMessage = new SyncMessage(SyncMessage.REQUEST, SyncMessage.SOURCE_LIST);
    socketPackage.socket.send(resolveFromJSON(srcListMessage));
  },
  checksums: function(socketPackage, data, customAssertions, cb) {
    if (!cb) {
      cb = customAssertions;
      customAssertions = null;
    }

    socketPackage.socket.removeListener("message", socketPackage.onMessage);
    socketPackage.socket.once("message", function(message) {
      // Reattach original listener
      socketPackage.socket.once("message", socketPackage.onMessage);


      if (!customAssertions) {
        var path = data.path;
        message = resolveToJSON(message);

        expect(message).to.exist;
        expect(message.type).to.equal(SyncMessage.RESPONSE);
        expect(message.name, "[SyncMessage Type error. SyncMessage.content was: " + message.content + "]").to.equal(SyncMessage.ACK);
        expect(message.content).to.exist;
        expect(message.content.path).to.exist;

        return cb(data);
      }

      customAssertions(message, cb);
    });

    var checksumResponse = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.CHECKSUM);
    socketPackage.socket.send(resolveFromJSON(checksumResponse));
  },
  diffs: function(socketPackage, data, fs, customAssertions, cb) {
    if (!cb) {
      cb = customAssertions;
      customAssertions = null;
    }

    var path = data.path;
    var srcList = data.srcList;

    socketPackage.socket.removeListener("message", socketPackage.onMessage);
    socketPackage.socket.once("message", function(message) {
      // Reattach original listener
      socketPackage.socket.once("message", socketPackage.onMessage);

      if (!customAssertions) {
        message = resolveToJSON(message);

        expect(message.type).to.equal(SyncMessage.RESPONSE);
        expect(message.name).to.equal(SyncMessage.DIFF);
        expect(message.content).to.exist;
        expect(message.content.diffs).to.exist;
        expect(message.content.path).to.exist;
        data.diffs = message.content.diffs;

        return cb(data);
      }

      customAssertions(message, cb);
    });

    var rsyncOptions = {
      size: 5,
      time: true,
      recursive: true
    };

    rsync.checksums(fs, path, srcList, rsyncOptions, function( err, checksums ) {
      expect(err).to.be.null;

      var diffRequest = new SyncMessage(SyncMessage.REQUEST, SyncMessage.DIFF);
      diffRequest.content = {
        checksums: checksums
      };

      socketPackage.socket.send(resolveFromJSON(diffRequest));
    });
  },
  patch: function(socketPackage, data, fs, customAssertions, cb) {
    if (!cb) {
      cb = customAssertions;
      customAssertions = null;
    }

    socketPackage.socket.removeListener("message", socketPackage.onMessage);
    socketPackage.socket.once("message", function(message) {
      socketPackage.socket.once("message", socketPackage.onMessage);

      message = resolveToJSON(message);

      expect(message).to.exist;
      expect(message.type).to.equal(SyncMessage.RESPONSE);
      expect(message.name, "[SyncMessage Type error. SyncMessage.content was: " + message.content + "]").to.equal(SyncMessage.ACK);

      cb();
    });

    var rsyncOptions = {
      size: 5,
      time: true,
      recursive: true
    };

    rsync.patch(fs, data.path, data.diffs, rsyncOptions, function(err) {
      expect(err).not.to.exist;

      var patchResponse = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.PATCH);
      socketPackage.socket.send(resolveFromJSON(patchResponse));
    });
  }
};

function prepareSync(finalStep, username, socketPackage, cb){
  if (typeof cb !== "function") {
    cb = socketPackage;
    socketPackage = username;
    username = finalStep;
    finalStep = null;
  }

  var fs = require('fs');
  var Path = require('path');
  var content = fs.readFileSync(Path.resolve(__dirname, '../test-files/test.txt'), {encoding: null});

  // Set up src filesystem
  upload(username, '/test.txt', content, function() {
    // Set up dest filesystem
    var fs = filesystem.create({
      keyPrefix: username,
      name: username
    });

    // Complete required sync steps
    if (!finalStep) {
      return cb(null, fs);
    }
    syncSteps.srcList(socketPackage, function(data1) {
      if (finalStep == "srcList") {
        return cb(data1, fs);
      }
      syncSteps.checksums(socketPackage, data1, function(data2) {
        if (finalStep == "checksums") {
          return cb(data2, fs);
        }
        syncSteps.diffs(socketPackage, data2, fs, function(data3) {
          if (finalStep == "diffs") {
            return cb(data3, fs);
          }
          syncSteps.patch(socketPackage, data3, fs, function(data4) {
            cb(data4, fs);
          });
        });
      });
    });
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
  openSocket: openSocket,
  upload: upload,
  cleanupSockets: cleanupSockets,
  resolveToJSON: resolveToJSON,
  resolveFromJSON: resolveFromJSON,
  prepareSync: prepareSync,
  syncSteps: syncSteps,
  getWebsocketToken: getWebsocketToken
};
