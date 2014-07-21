var request = require('request');
var expect = require('chai').expect;
var ws = require('ws');
var filesystem = require('../../server/lib/filesystem.js');
var SyncMessage = require('../../lib/syncmessage');
var rsync = require('../../lib/rsync');
var rsyncOptions = require('../../lib/constants').rsyncDefaults;
var Filer = require('../../lib/filer.js');
var Buffer = Filer.Buffer;
var Path = Filer.Path;
var uuid = require( "node-uuid" );
var async = require('async');
var diffHelper = require("../../lib/diff");

// Ensure the client timeout restricts tests to a reasonable length
var env = require('../../server/lib/environment');
env.set('CLIENT_TIMEOUT_MS', 1000);

var app = require('../../server/index.js');

var serverURL = 'http://0.0.0.0:9090',
    socketURL = serverURL.replace( 'http', 'ws' );

// Mock Webmaker auth
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

// Mock File Upload into Filer FileSystem.  URLs will look like this:
// /upload/:username/:path (where :path will contain /s)
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

    fs.writeFile(path, fileData, function(err) {
      if(err) {
        res.send(500, {error: err});
        return;
      }

      res.send(200);
    });

  });
});

/**
 * Misc Helpers
 */
function uniqueUsername() {
  return 'user' + uuid.v4();
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

// Ensure that the file is downloadable via /p/ route
// and has the proper contents
function ensureFile(path, contents, jar, callback) {
  request.get({
    url: serverURL + '/p' + path,
    jar: jar
  }, function(err, res, body) {
    expect(err).not.to.exist;
    expect(res.statusCode).to.equal(200);
    expect(body).to.equal(contents);

    callback();
  });
}


function resolveToJSON(string) {
  return SyncMessage.parse(JSON.parse(string));
}

function resolveFromJSON(obj) {
  return obj.stringify();
}

/**
 * Connection Helpers
 */
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
    // Reset the jar to kill existing auth cookie
    options.jar = jar();
    cb();
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

  authenticate(options, function(err, result) {
    if(err) {
      return callback(err);
    }

    getWebsocketToken(result, function(err, result1) {
      if(err){
        return callback(err);
      }

      var testDone = result1.done;
      result1.done = function() {
        options.logoutUser(function() {
          testDone && testDone();
        });
      };

      callback(null, result1);
    });
  });
}

function jar() {
  return request.jar();
}

/**
 * Socket Helpers
 */
function openSocket(socketData, options) {
  if (typeof options !== "object") {
    if (socketData && !socketData.token) {
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
    var customMessageHandler = options.onMessage;
    options.onOpen = function() {
      socket.send(JSON.stringify({
        token: socketData.token
      }));
    };
    options.onMessage = function(message) {
      expect(message).to.equal(SyncMessage.response.authz.stringify());
      if (customMessageHandler) {
        socket.once("message", customMessageHandler);
      }
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

function sendSyncMessage(socketPackage, syncMessage, callback) {
  var socket = socketPackage.socket;
  socketPackage.setMessage(callback);
  socketPackage.socket.send(resolveFromJSON(syncMessage));
}

/**
 * Sync Helpers
 */
var downstreamSyncSteps = {
  generateDiffs: function(socketPackage, data, fs, customAssertions, cb) {
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

        expect(message.type, "[Diffs error: \"" + (message.content && message.content.error) + "\"]").to.equal(SyncMessage.RESPONSE);
        expect(message.name).to.equal(SyncMessage.DIFFS);
        expect(message.content).to.exist;
        expect(message.content.diffs).to.exist;
        expect(message.content.path).to.exist;
        data.diffs = diffHelper.deserialize(message.content.diffs);

        return cb(data);
      }

      customAssertions(message, cb);
    });

    rsync.checksums(fs, path, srcList, rsyncOptions, function( err, checksums ) {
      expect(err).to.be.null;

      var diffRequest = SyncMessage.request.diffs;
      diffRequest.content = {
        checksums: checksums
      };

      socketPackage.socket.send(diffRequest.stringify());
    });
  },
  patchClientFilesystem: function(socketPackage, data, fs, customAssertions, cb) {
    if (!cb) {
      cb = customAssertions;
      customAssertions = null;
    }

    rsync.patch(fs, data.path, data.diffs, rsyncOptions, function(err) {
      expect(err, "[Rsync patch error: \"" + err + "\"]").not.to.exist;

      var patchResponse = SyncMessage.response.patch;
      socketPackage.socket.send(resolveFromJSON(patchResponse));

      cb();
    });
  }
};

var upstreamSyncSteps = {
  requestSync: function(socketPackage, customAssertions, cb) {
    if (!cb) {
      cb = customAssertions;
      customAssertions = null;
    }

    socketPackage.socket.removeListener("message", socketPackage.onMessage);
    socketPackage.socket.once("message", function(message) {
      // Reattach original listener
      socketPackage.socket.once("message", socketPackage.onMessage);

      if (!customAssertions) {
        message = resolveToJSON(message);

        expect(message).to.exist;
        expect(message.type).to.equal(SyncMessage.RESPONSE);
        expect(message.name, "[SyncMessage Type error. SyncMessage.content was: " + message.content + "]").to.equal(SyncMessage.SYNC);

        return cb();
      }

      customAssertions(message, cb);
    });

    var requestSyncMessage = SyncMessage.request.sync;
    socketPackage.socket.send(resolveFromJSON(requestSyncMessage));
  },
  generateChecksums: function(socketPackage, data, customAssertions, cb) {
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
        expect(message.type).to.equal(SyncMessage.REQUEST);
        expect(message.name, "[SyncMessage Type error. SyncMessage.content was: " + message.content + "]").to.equal(SyncMessage.DIFFS);
        expect(message.content).to.exist;
        expect(message.content.checksums).to.exist;
        expect(message.content.path).to.exist;

        return cb();
      }

      customAssertions(message, cb);
    });

    var requestChksumMsg = SyncMessage.request.chksum;
    requestChksumMsg.content = {
      path: data.path,
      srcList: data.srcList
    };
    socketPackage.socket.send(resolveFromJSON(requestChksumMsg));
  },
  patchServerFilesystem: function(socketPackage, data, fs, customAssertions, cb) {
    if (!cb) {
      cb = customAssertions;
      customAssertions = null;
    }

    var path = data.path;
    var checksums = data.checksums;

    socketPackage.socket.removeListener("message", socketPackage.onMessage);
    socketPackage.socket.once("message", function(message) {
      // Reattach original listener
      socketPackage.socket.once("message", socketPackage.onMessage);

      if (!customAssertions) {
        message = resolveToJSON(message);

        expect(message.type, "[Diffs error: \"" + (message.content && message.content.error) + "\"]").to.equal(SyncMessage.RESPONSE);
        expect(message.name).to.equal(SyncMessage.PATCH);

        return cb();
      }

      customAssertions(message, cb);
    });

    rsync.diff(fs, path, checksums, rsyncOptions, function( err, diffs ) {
      expect(err).to.be.null;

      var patchResponse = SyncMessage.response.patch;
      patchResponse.content = {
        diffs: diffHelper.serialize(diffs)
      };

      socketPackage.socket.send(patchResponse.stringify());
    });
  }
};

function prepareDownstreamSync(finalStep, username, token, cb){
  if (typeof cb !== "function") {
    cb = token;
    token = username;
    username = finalStep;
    finalStep = null;
  }

  var testFile = {
    name: "test.txt",
    content: "Hello world!"
  };

  // Set up server filesystem
  upload(username, '/' + testFile.name, testFile.content, function() {
    // Set up client filesystem
    var fs = filesystem.create({
      keyPrefix: username + "client",
      name: username + "client"
    });

    var socketPackage = openSocket({
      onMessage: function(message) {
        message = resolveToJSON(message);

        expect(message).to.exist;
        expect(message.type).to.equal(SyncMessage.RESPONSE);
        expect(message.name).to.equal(SyncMessage.AUTHZ);
        expect(message.content).to.be.null;

        socketPackage.socket.once("message", function(message) {
          message = resolveToJSON(message);
          expect(message).to.exist;
          expect(message.type).to.equal(SyncMessage.REQUEST);
          expect(message.name).to.equal(SyncMessage.CHKSUM);
          expect(message.content).to.exist;
          expect(message.content.srcList).to.exist;
          expect(message.content.path).to.exist;

          var downstreamData = {
            srcList: message.content.srcList,
            path: message.content.path
          };

          // Complete required sync steps
          if (!finalStep) {
            return cb(downstreamData, fs, socketPackage);
          }
          downstreamSyncSteps.generateDiffs(socketPackage, downstreamData, fs, function(data1) {
            if (finalStep == "generateDiffs") {
              return cb(data1, fs, socketPackage);
            }
            downstreamSyncSteps.patchClientFilesystem(socketPackage, data1, fs, function(data2) {
              cb(data2, fs, socketPackage);
            });
          });
        });
      },
      onOpen: function() {
        socketPackage.socket.send(JSON.stringify({
          token: token
        }));
      }
    });
  });
}

/**
 * Takes an fs instance and creates all the files and dirs
 * in layout.  A layout is a flat representation of files/dirs
 * and looks like this:
 *
 * {
 *   "/path/to/file": "contents of file",
 *   "/path/to/dir": null,
 *   "/path/to/dir/file": <Buffer>
 * }
 *
 * Files are paths with contents (non-null), and empty dirs are
 * marked with null.
 */
function createFilesystemLayout(fs, layout, callback) {
  var paths = Object.keys(layout);
  var sh = fs.Shell();

  function createPath(path, callback) {
    var contents = layout[path];
    // Path is either a file (string/Buffer) or empty dir (null)
    if(contents) {
      sh.mkdirp(Path.dirname(path), function(err) {
        if(err) {
          return callback(err);
        }

        fs.writeFile(path, contents, callback);
      });
    } else {
      sh.mkdirp(path, callback);
    }
  }

  async.eachSeries(paths, createPath, callback);
}

/**
 * Deletes all paths specified in paths array, or everything
 * if no paths are given.
 */
function deleteFilesystemLayout(fs, paths, callback) {
  if(!paths) {
    fs.readdir('/', function(err, entries) {
      if(err) {
        return callback(err);
      }

      entries = entries.map(function(path) {
        return Path.join('/', path);
      });

      deleteFilesystemLayout(fs, entries, callback);
    });
  } else {
    var sh = fs.Shell();
    function rm(path, callback) {
      sh.rm(path, {recursive: true}, callback);
    }
    async.eachSeries(paths, rm, callback);
  }
}

// Strip .modified times from ever element in the array, or its .contents
function stripModified(listing) {
  function strip(item) {
    delete item.modified;
    if(item.contents) {
      item.contents = stripModified(item.contents);
    }
    return item;
  }

  if(Array.isArray(listing)) {
    return listing.map(strip);
  } else {
    return strip(listing);
  }
}

/**
 * Makes sure that the layout given matches what's actually
 * in the current fs.  Use ensureFilesystemContents if you
 * want to ensure file/dir contents vs. paths.
 */
function ensureFilesystemLayout(fs, layout, callback) {
  // Start by creating the layout, then compare a deep ls()
  var fs2 = new Filer.FileSystem({provider: new Filer.FileSystem.providers.Memory(uniqueUsername())});
  createFilesystemLayout(fs2, layout, function(err) {
    expect(err).not.to.exist;
    if(err) {
      return callback(err);
    }

    var sh = fs.Shell();
    sh.ls('/', {recursive: true}, function(err, fsListing) {
      expect(err).not.to.exist;
      if(err) {
        return callback(err);
      }

      var sh2 = fs2.Shell();
      sh2.ls('/', {recursive: true}, function(err, fs2Listing) {
        expect(err).not.to.exist;
        if(err) {
          return callback(err);
        }

        // Remove modified
        fsListing = stripModified(fsListing);
        fs2Listing = stripModified(fs2Listing);

        expect(fsListing).to.deep.equal(fs2Listing);
        callback();
      });
    });
  });
}

/**
 * Makes sure that the layout given matches what's actually
 * in the remote fs.  Use ensureFilesystemContents if you
 * want to ensure file/dir contents vs. paths.
 */
function ensureRemoteFilesystemLayout(layout, jar, callback) {
  // Start by creating the layout, then compare a deep ls()
  var layoutFS = new Filer.FileSystem({provider: new Filer.FileSystem.providers.Memory(uniqueUsername())});
  createFilesystemLayout(layoutFS, layout, function(err) {
    expect(err).not.to.exist;
    if(err) {
      return callback(err);
    }

    var sh = layoutFS.Shell();
    sh.ls('/', {recursive: true}, function(err, layoutFSListing) {
      expect(err).not.to.exist;
      if(err) {
        return callback(err);
      }

      // Now grab the remote server listing using the /j/* route
      request.get({
        url: serverURL + '/j/',
        jar: jar,
        json: true
      }, function(err, res, remoteFSListing) {
        expect(err).not.to.exist;
        expect(res.statusCode).to.equal(200);

        // Remove modified
        layoutFSListing = stripModified(layoutFSListing);
        remoteFSListing = stripModified(remoteFSListing);

        expect(remoteFSListing).to.deep.equal(layoutFSListing);
        callback(err);
      });
    });
  });
}

/**
 * Ensure that the files and dirs match the layout's contents.
 * Use ensureFilesystemLayout if you want to ensure file/dir paths vs. contents.
 */
function ensureFilesystemContents(fs, layout, callback) {
  function ensureFileContents(filename, expectedContents, callback) {
    var encoding = Buffer.isBuffer(expectedContents) ? null : 'utf8';
    fs.readFile(filename, encoding, function(err, actualContents) {
      expect(err).not.to.exist;
      if(err) {
        return callback(err);
      }

      expect(actualContents).to.deep.equal(expectedContents);
      callback();
    });
  }

  function ensureEmptyDir(dirname, callback) {
    fs.stat(dirname, function(err, stats) {
      expect(err).not.to.exist;
      if(err) {
        return callback(err);
      }

      expect(stats.isDirectory()).to.be.true;

      // Also make sure it's empty
      fs.readdir(dirname, function(err, entries) {
        expect(err).not.to.exist;
        if(err) {
          return callback(err);
        }

        expect(entries.length).to.equal(0);
        callback();
      });
    });
  }

  function processPath(path, callback) {
    var contents = layout[path];
    if(contents) {
      ensureFileContents(path, contents, callback);
    } else {
      ensureEmptyDir(path, callback);
    }
  }

  async.eachSeries(Object.keys(layout), processPath, callback);
}

/**
 * Ensure that the remote files and dirs match the layout's contents.
 * Use ensureRemoteFilesystemLayout if you want to ensure file/dir paths vs. contents.
 */
function ensureRemoteFilesystemContents(layout, jar, callback) {
  function ensureRemoteFileContents(filename, expectedContents, callback) {
    request.get({
      url: serverURL + '/j' + filename,
      jar: jar,
      json: true
    }, function(err, res, actualContents) {
      expect(err).not.to.exist;
      expect(res.statusCode).to.equal(200);

      if(!Buffer.isBuffer(expectedContents)) {
        expectedContents = new Buffer(expectedContents);
      }

      if(!Buffer.isBuffer(actualContents)) {
        actualContents = new Buffer(actualContents);
      }

      expect(actualContents).to.deep.equal(expectedContents);
      callback(err);
    });
  }

  function ensureRemoteEmptyDir(dirname, callback) {
    request.get({
      url: serverURL + '/j' + dirname,
      jar: jar,
      json: true
    }, function(err, res, listing) {
      expect(err).not.to.exist;
      expect(res.statusCode).to.equal(200);

      expect(Array.isArray(listing)).to.be.true;
      expect(listing.length).to.equal(0);

      callback(err);
    });
  }

  function processPath(path, callback) {
    var contents = layout[path];
    if(contents) {
      ensureRemoteFileContents(path, contents, callback);
    } else {
      ensureRemoteEmptyDir(path, callback);
    }
  }

  async.eachSeries(Object.keys(layout), processPath, callback);
}

/**
 * Runs ensureFilesystemLayout and ensureFilesystemContents on fs
 * for given layout, making sure all paths and files/dirs match expected.
 */
function ensureFilesystem(fs, layout, callback) {
  ensureFilesystemLayout(fs, layout, function(err) {
    if(err) {
      return callback(err);
    }
    ensureFilesystemContents(fs, layout, callback);
  });
}

/**
 * Runs ensureRemoteFilesystemLayout and ensureRemoteFilesystemContents
 * for given layout, making sure all paths and files/dirs match expected.
 */
function ensureRemoteFilesystem(layout, jar, callback) {
  ensureRemoteFilesystemLayout(layout, jar, function(err) {
    if(err) {
      return callback(err);
    }
    ensureRemoteFilesystemContents(layout, jar, callback);
  });
}

function prepareUpstreamSync(finalStep, username, token, cb){
  if (typeof cb !== "function") {
    cb = token;
    token = username;
    username = finalStep;
    finalStep = null;
  }

  completeDownstreamSync(username, token, function(data, fs, socketPackage) {
    // Complete required sync steps
    if (!finalStep) {
      return cb(data, fs, socketPackage);
    }
    upstreamSyncSteps.requestSync(socketPackage, fs, function(data1) {
      if (finalStep == "requestSync") {
        return cb(data1, fs, socketPackage);
      }
      upstreamSyncSteps.generateChecksums(socketPackage, data1, fs, function(data2) {
        if (finalStep == "generateChecksums") {
          return cb(data2, fs, socketPackage);
        }
        upstreamSyncSteps.patchServerFilesystem(socketPackage, data2, fs, function(data3) {
          cb(data3, fs, socketPackage);
        });
      });
    });
  });
}

function completeDownstreamSync(username, token, cb) {
  prepareDownstreamSync("patch", username, token, function(data, fs, socketPackage) {
    cb(data, fs, socketPackage);
  });
}

module.exports = {
  // Misc helpers
  app: app,
  serverURL: serverURL,
  socketURL: socketURL,
  username: uniqueUsername,
  createJar: jar,
  resolveToJSON: resolveToJSON,
  resolveFromJSON: resolveFromJSON,

  // Connection helpers
  authenticate: authenticate,
  authenticatedConnection: authenticateAndConnect,
  getWebsocketToken: getWebsocketToken,

  // Socket helpers
  openSocket: openSocket,
  upload: upload,
  cleanupSockets: cleanupSockets,

  // Filesystem helpers
  ensureFile: ensureFile,
  createFilesystemLayout: createFilesystemLayout,
  deleteFilesystemLayout: deleteFilesystemLayout,
  ensureFilesystemContents: ensureFilesystemContents,
  ensureFilesystemLayout: ensureFilesystemLayout,
  ensureRemoteFilesystemContents: ensureRemoteFilesystemContents,
  ensureRemoteFilesystemLayout: ensureRemoteFilesystemLayout,
  ensureFilesystem: ensureFilesystem,
  ensureRemoteFilesystem: ensureRemoteFilesystem,

  // Sync helpers
  upload: upload,
  prepareDownstreamSync: prepareDownstreamSync,
  prepareUpstreamSync: prepareUpstreamSync,
  downstreamSyncSteps: downstreamSyncSteps,
  upstreamSyncSteps: upstreamSyncSteps,
  sendSyncMessage: sendSyncMessage,
  completeDownstreamSync: completeDownstreamSync
};
