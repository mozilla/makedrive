var expect = require('chai').expect;
var util = require('../lib/server-utils.js');
var testUtils = require('../lib/util.js');
var SyncMessage = require('../../lib/syncmessage');
var WS = require('ws');
var syncTypes = require('../../lib/constants').syncTypes;
var diffHelper = require('../../lib/diff');
var FAKE_DATA = 'FAKE DATA';

function validateSocketMessage(message, expectedMessage, checkExists) {
  message = util.decodeSocketMessage(message);
  checkExists = checkExists || [];

  expect(message.type).to.equal(expectedMessage.type);
  expect(message.name).to.equal(expectedMessage.name);

  if(!expectedMessage.content) {
    expect(message.content).not.to.exist;
    return;
  }

  expect(message.content).to.exist;

  if(typeof message.content !== 'object') {
    expect(message.content).to.deep.equal(expectedMessage.content);
    return;
  }

  Object.keys(expectedMessage.content).forEach(function(key) {
    if(checkExists.indexOf(key) !== -1) {
      expect(message.content[key]).to.exist;
    } else {
      expect(message.content[key]).to.deep.equal(expectedMessage.content[key]);
    }
  });
}

describe('The Server', function(){
  before(function(done) {
    util.start(done);
  });
  after(function(done) {
    util.shutdown(done);
  });

  describe('[Socket protocol] -', function() {
    var socket, socket2;

    afterEach(function() {
      if(socket) {
        socket.close();
      }
      if(socket2) {
        socket2.close();
      }
    });

    it('should close a socket if bad data is sent in place of websocket-auth token', function(done) {
      util.run(function() {
        socket = new WS(util.socketURL);

        socket.onmessage = function() {
          expect(true).to.be.false;
        };
        socket.onopen = function() {
          socket.send('This is not a token');
        };
        socket.onclose = function(closeMessage) {
          expect(closeMessage).to.exist;
          expect(closeMessage.code).to.equal(1011);
          done();
        };
      });
    });

    it('shouldn\'t allow the same token to be used twice', function(done) {
      util.authenticatedConnection({done: done}, function(err, result) {
        expect(err).not.to.exist;

        socket = new WS(util.socketURL);
        var authMsg = {token: result.token};

        socket.onmessage = function() {
          socket2 = new WS(util.socketURL);

          socket2.onmessage = function() {
            expect(true).to.be.false;
          };
          socket2.onopen = function() {
            socket2.send(JSON.stringify(authMsg));
          };
          socket2.onclose = function(closeMessage) {
            expect(closeMessage).to.exist;
            expect(closeMessage.code).to.equal(1008);
            done();
          };
        };
        socket.onopen = function() {
          socket.send(JSON.stringify(authMsg));
        };
      });
    });

    it('should send a "RESPONSE" of "AUTHZ" after receiving a valid token and syncId', function(done) {
      util.authenticatedConnection({done: done}, function(err, result) {
        expect(err).not.to.exist;

        socket = new WS(util.socketURL);
        socket.onmessage = function(message) {
          validateSocketMessage(message, SyncMessage.response.authz);
          done();
        };
        socket.onopen = function() {
          socket.send(JSON.stringify({token: result.token}));
        };
      });
    });

    it('should allow two socket connections for the same username from different clients', function(done) {
      util.authenticatedConnection(function(err, result) {
        expect(err).not.to.exist;

        socket = new WS(util.socketURL);
        socket.onmessage = function() {
          util.authenticatedConnection({username: result.username}, function(err, result2) {
            expect(err).not.to.exist;
            expect(result2).to.exist;
            expect(result2.username).to.equal(result.username);
            expect(result2.token).not.to.equal(result.token);

            socket2 = new WS(util.socketURL);
            socket2.onmessage = function(message) {
              validateSocketMessage(message, SyncMessage.response.authz);
              done();
            };
            socket2.onopen = function() {
              socket2.send(JSON.stringify({token: result2.token}));
            };
          });
        };
        socket.onopen = function() {
          socket.send(JSON.stringify({token: result.token}));
        };
      });
    });

    it('should send a format SyncMessage error if a non-SyncMessage is sent', function(done) {
      util.authenticatedSocket(function(err, result, socket) {
        if(err) throw err;

        socket.onmessage = function(message) {
          var expectedMessage = SyncMessage.error.format;
          expectedMessage.content = 'Message must be formatted as a sync message';
          validateSocketMessage(message, expectedMessage);
          socket.close();
          done();
        };

        socket.send(JSON.stringify({message: 'This is not a sync message'}));
      });
    });
  });

  describe('[Downstream syncs] -', function(){
    var authResponse = SyncMessage.response.authz.stringify();

    it('should send a "REQUEST" for "CHECKSUMS" to trigger a downstream when a client connects and the server has a non-empty filesystem', function(done) {
      var username = testUtils.username();
      var file = {path: '/file', content: 'This is a file'};

      util.upload(username, file.path, file.content, function(err) {
        if(err) throw err;

        util.authenticatedSocket({username: username}, function(err, result, socket) {
          if(err) throw err;

          socket.onmessage = function(message) {
            var expectedMessage = SyncMessage.request.checksums;
            expectedMessage.content = {path: file.path, type: syncTypes.CREATE, sourceList: FAKE_DATA};
            validateSocketMessage(message, expectedMessage, ['sourceList']);
            socket.close();
            done();
          };

          socket.send(authResponse);
        });
      });
    });

    it('should send a "RESPONSE" of "DIFFS" when requested for diffs', function(done) {
      var username = testUtils.username();
      var file = {path: '/file', content: 'This is a file'};
      var checksums = testUtils.generateChecksums([file]);
      var diffRequest = SyncMessage.request.diffs;
      diffRequest.content = {path: file.path, type: syncTypes.CREATE, checksums: checksums[0]};

      util.upload(username, file.path, file.content, function(err) {
        if(err) throw err;

        util.authenticatedSocket({username: username}, function(err, result, socket) {
          if(err) throw err;

          socket.onmessage = function(message) {
            var expectedMessage = SyncMessage.response.diffs;
            expectedMessage.content = {path: file.path, type: syncTypes.CREATE, diffs: FAKE_DATA};
            validateSocketMessage(message, expectedMessage, ['diffs']);
            socket.close();
            done();
          };

          socket.send(diffRequest.stringify());
        });
      });
    });

    it('should send a "RESPONSE" of "VERIFICATION" on receiving a patch response', function(done) {
      var username = testUtils.username();
      var initializedDownstream = false;
      var file = {path: '/file', content: 'This is a file'};
      var checksums = testUtils.generateValidationChecksums([file]);
      var patchResponse = SyncMessage.response.patch;
      patchResponse.content = {path: file.path, type: syncTypes.CREATE, checksum: checksums};

      util.upload(username, file.path, file.content, function(err) {
        if(err) throw err;

        util.authenticatedSocket({username: username}, function(err, result, socket) {
          if(err) throw err;

          socket.onmessage = function(message) {
            var expectedMessage = SyncMessage.response.verification;
            expectedMessage.content = {path: file.path, type: syncTypes.CREATE};

            if(!initializedDownstream) {
              initializedDownstream = true;
              return socket.send(patchResponse.stringify());
            }

            validateSocketMessage(message, expectedMessage);
            socket.close();
            done();
          };

          socket.send(authResponse);
        });
      });
    });

    it('should allow an upstream sync request for a file if that file has been downstreamed', function(done) {
      var username = testUtils.username();
      var file = {path: '/file', content: 'This is a file'};
      var currentStep = 'AUTH';
      var checksums = testUtils.generateValidationChecksums([file]);
      var patchResponse = SyncMessage.response.patch;
      patchResponse.content = {path: file.path, type: syncTypes.CREATE, checksum: checksums};
      var syncRequest = SyncMessage.request.sync;
      syncRequest.content = {path: file.path, type: syncTypes.CREATE};

      util.upload(username, file.path, file.content, function(err) {
        if(err) throw err;

        util.authenticatedSocket({username: username}, function(err, result, socket) {
          if(err) throw err;

          socket.onmessage = function(message) {
            if(currentStep === 'AUTH') {
              currentStep = 'PATCH';
              socket.send(patchResponse.stringify());
            } else if(currentStep === 'PATCH') {
              currentStep = null;
              socket.send(syncRequest.stringify());
            } else {
              var expectedMessage = SyncMessage.response.sync;
              expectedMessage.content = {path: file.path, type: syncTypes.CREATE};
              validateSocketMessage(message, expectedMessage);
              socket.close();
              done();
            }
          };

          socket.send(authResponse);
        });
      });
    });

    it('should handle root responses from the client by removing the file from the downstream queue for that client', function(done) {
      // Since we do not have access to the internals of the server,
      // we test this case by sending a root response to the server
      // and requesting an upstream sync for the same file, which
      // should succeed.
      var username = testUtils.username();
      var file = {path: '/file', content: 'This is a file'};
      var rootMessage = SyncMessage.response.root;
      rootMessage.content = {path: file.path, type: syncTypes.CREATE};
      var syncRequest = SyncMessage.request.sync;
      syncRequest.content = {path: file.path, type: syncTypes.CREATE};
      var rootMessageSent = false;

      util.upload(username, file.path, file.content, function(err) {
        if(err) throw err;

        util.authenticatedSocket({username: username}, function(err, result, socket) {
          if(err) throw err;

          socket.onmessage = function(message) {
            if(!rootMessageSent) {
              // NOTE: Under normal circumstances, a sync request
              // message would not be sent to the server, however
              // since that is the only way to test server internals
              // (indirectly), this has an important implication.
              // This test may fail as two socket messages are sent
              // one after the other and an ASSUMPTION has been made
              // that the first socket message executes completely
              // before the second socket message executes. If this
              // test fails, the most likely cause would be the below
              // three lines of code that introduces a timing issue.
              socket.send(rootMessage.stringify());
              rootMessageSent = true;
              return socket.send(syncRequest.stringify());
            }

            var expectedMessage = SyncMessage.response.sync;
            expectedMessage.content = {path: file.path, type: syncTypes.CREATE};
            validateSocketMessage(message, expectedMessage);
            socket.close();
            done();
          };

          socket.send(authResponse);
        });
      });
    });

    it('should send a "DOWNSTREAM_LOCKED" "ERROR" if a "REQUEST" for "DIFFS" is sent while an upstream sync is triggered for the same file by another client', function(done) {
      var username = testUtils.username();
      var file = {path: '/file', content: 'This is a file'};
      var checksums = testUtils.generateChecksums([file]);
      var diffRequest = SyncMessage.request.diffs;
      diffRequest.content = {path: file.path, type: syncTypes.CREATE, checksums: checksums[0]};
      var authorized = false;
      var syncRequest = SyncMessage.request.sync;
      syncRequest.content = {path: file.path, type: syncTypes.CREATE};

      util.upload(username, file.path, file.content, function(err) {
        if(err) throw err;

        util.authenticatedSocket({username: username}, function(err, result, socket) {
          if(err) throw err;

          util.authenticatedSocket({username: username}, function(err, result, socket2) {
            if(err) throw err;

            socket.onmessage = function(message) {
              if(!authorized) {
                authorized = true;
                return socket2.send(syncRequest.stringify());
              }

              var expectedMessage = SyncMessage.error.downstreamLocked;
              expectedMessage.content = {path: file.path, type: syncTypes.CREATE};
              validateSocketMessage(message, expectedMessage);
              socket.close();
              socket2.close();
              done();
            };

            socket2.onmessage = function() {
              socket.send(diffRequest.stringify());
            };

            socket.send(authResponse);
          });
        });
      });
    });

    it('should send a "VERIFICATION" "ERROR" on receiving a patch response that incorrectly patched a file on the client', function(done) {
      var username = testUtils.username();
      var initializedDownstream = false;
      var file = {path: '/file', content: 'This is a file'};
      var patchResponse = SyncMessage.response.patch;
      patchResponse.content = {path: file.path, type: syncTypes.CREATE};

      util.upload(username, file.path, file.content, function(err) {
        if(err) throw err;

        file.content = 'Modified content';
        patchResponse.content.checksum = testUtils.generateValidationChecksums([file]);

        util.authenticatedSocket({username: username}, function(err, result, socket) {
          if(err) throw err;

          socket.onmessage = function(message) {
            var expectedMessage = SyncMessage.error.verification;
            expectedMessage.content = {path: file.path, type: syncTypes.CREATE};

            if(!initializedDownstream) {
              initializedDownstream = true;
              return socket.send(patchResponse.stringify());
            }

            validateSocketMessage(message, expectedMessage);
            socket.close();
            done();
          };

          socket.send(authResponse);
        });
      });
    });
  });

  describe('[Upstream syncs] -', function() {
    var file = {path: '/file', content: 'This is a file'};

    it('should send a "RESPONSE" of "SYNC" if a sync is requested on a file without a lock', function(done) {
      var syncRequest = SyncMessage.request.sync;
      syncRequest.content = {path: file.path, type: syncTypes.CREATE};

      util.authenticatedSocket(function(err, result, socket) {
        if(err) throw err;

        socket.onmessage = function(message) {
          var expectedMessage = SyncMessage.response.sync;
          expectedMessage.content = {path: file.path, type: syncTypes.CREATE};

          validateSocketMessage(message, expectedMessage);
          socket.close();
          done();
        };

        socket.send(syncRequest.stringify());
      });
    });

    it('should send a "LOCKED" "ERROR" if a sync is requested on a file that is locked', function(done) {
      var syncRequest = SyncMessage.request.sync;
      syncRequest.content = {path: file.path, type: syncTypes.CREATE};

      util.authenticatedSocket(function(err, result, socket) {
        if(err) throw err;

        util.authenticatedSocket({username: result.username}, function(err, result, socket2) {
          if(err) throw err;

          socket.onmessage = function() {
            socket2.send(syncRequest.stringify());
          };

          socket2.onmessage = function(message) {
            var expectedMessage = SyncMessage.error.locked;
            expectedMessage.content = {error: 'Sync already in progress', path: file.path, type: syncTypes.CREATE};

            validateSocketMessage(message, expectedMessage);
            socket.close();
            socket2.close();
            done();
          };

          socket.send(syncRequest.stringify());
        });
      });
    });

    it('should send a "REQUEST" for "DIFFS" containing checksums when requested for checksums', function(done) {
      var syncRequested = false;
      var syncRequest = SyncMessage.request.sync;
      syncRequest.content = {path: file.path, type: syncTypes.CREATE};
      var checksumRequest = SyncMessage.request.checksums;
      checksumRequest.content = {path: file.path, type: syncTypes.CREATE, sourceList: testUtils.generateSourceList([file])};

      util.authenticatedSocket(function(err, result, socket) {
        if(err) throw err;

        socket.onmessage = function(message) {
          var expectedMessage = SyncMessage.request.diffs;
          expectedMessage.content = {path: file.path, type: syncTypes.CREATE, checksums: FAKE_DATA};

          if(!syncRequested) {
            syncRequested = true;
            return socket.send(checksumRequest.stringify());
          }

          validateSocketMessage(message, expectedMessage, ['checksums']);
          socket.close();
          done();
        };

        socket.send(syncRequest.stringify());
      });
    });

    it('should patch the file being synced and send a "RESPONSE" of "PATCH" on receiving a diff response', function(done) {
      var syncRequested = false;
      var syncRequest = SyncMessage.request.sync;
      syncRequest.content = {path: file.path, type: syncTypes.CREATE};
      var diffResponse = SyncMessage.response.diffs;
      diffResponse.content = {path: file.path, type: syncTypes.CREATE, diffs: diffHelper.serialize(testUtils.generateDiffs([file]))};
      var layout = {};
      layout[file.path] = file.content;

      util.authenticatedSocket(function(err, result, socket) {
        if(err) throw err;

        socket.onmessage = function(message) {
          var expectedMessage = SyncMessage.response.patch;
          expectedMessage.content = {path: file.path, type: syncTypes.CREATE};

          if(!syncRequested) {
            syncRequested = true;
            return socket.send(diffResponse.stringify());
          }

          validateSocketMessage(message, expectedMessage);
          util.ensureRemoteFilesystem(layout, result.jar, function(err) {
            expect(err).not.to.exist;
            socket.close();
            done();
          });
        };

        socket.send(syncRequest.stringify());
      });
    });

    it('should trigger a downstream sync on other clients on completing an upstream sync', function(done) {
      var syncRequest = SyncMessage.request.sync;
      var syncRequested = false;
      syncRequest.content = {path: file.path, type: syncTypes.CREATE};
      var diffResponse = SyncMessage.response.diffs;
      diffResponse.content = {path: file.path, type: syncTypes.CREATE, diffs: diffHelper.serialize(testUtils.generateDiffs([file]))};

      util.authenticatedSocket(function(err, result, socket) {
        if(err) throw err;

        util.authenticatedSocket({username: result.username}, function(err, result, socket2) {
          if(err) throw err;

          socket2.onmessage = function(message) {
            var expectedMessage = SyncMessage.request.checksums;
            expectedMessage.content = {path: file.path, type: syncTypes.CREATE, sourceList: FAKE_DATA};

            validateSocketMessage(message, expectedMessage, ['sourceList']);
            socket.close();
            socket2.close();
            done();
          };

          socket.onmessage = function() {
            if(!syncRequested) {
              syncRequested = true;
              socket.send(diffResponse.stringify());
            }
          };

          socket.send(syncRequest.stringify());
        });
      });
    });
  });
});
