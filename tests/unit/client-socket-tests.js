var expect = require('chai').expect;
var util = require('../lib/client-utils.js');
var testUtils = require('../lib/util.js');
var SyncMessage = require('../../lib/syncmessage.js');
var MakeDrive = require('../../client/src');
var Filer = require('../../lib/filer.js');
var syncTypes = require('../../lib/constants.js').syncTypes;
var diffHelper = require('../../lib/diff.js');
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

function incorrectEvent() {
  expect(true, '[Incorrect sync event emitted]').to.be.false;
}

describe('The Client', function() {
  var SocketServer;

  after(function(done) {
    util.close(done);
  });

  describe('Socket protocol', function() {
    var fs;
    var sync;

    beforeEach(function(done) {
      util.run(function(server) {
        SocketServer = server;
        fs = MakeDrive.fs({forceCreate: true, manual: true, provider: new Filer.FileSystem.providers.Memory(testUtils.username())});
        sync = fs.sync;
        done();
      });
    });

    afterEach(function(done){
      testUtils.disconnectClient(sync, function(err) {
        if(err) throw err;

        sync = null;
        fs = null;
        done();
      });
    });

    it('should emit a sync error if authentication fails', function(done) {
      SocketServer.once('connection', function(client) {
        client.once('message', function(message) {
          var message = SyncMessage.error.format;
          message.content = {error: 'Unable to parse/handle message, invalid message format.'};
          client.send(message.stringify());
        });
      });

      sync.once('connected', incorrectEvent);
      sync.once('error', function(err) {
        expect(err).to.exist;
        expect(err.message).to.equal('Cannot handle message');
        done();
      });

      sync.connect(util.socketURL, 'This is not a token');
    });

    it('should send emit a connected event on successfully authenticating with the server', function(done) {
      SocketServer.once('connection', function(client) {
        client.once('message', function() {
          client.send(SyncMessage.response.authz.stringify());
        });
      });

      sync.once('connected', function(url) {
        expect(url).to.equal(util.socketURL);
        done();
      });
      sync.once('disconnected', incorrectEvent);
      sync.once('error', incorrectEvent);

      sync.connect(util.socketURL, 'This is a valid token');
    });
  });

  describe('Downstream syncs', function() {
    var fs;
    var sync;

    beforeEach(function(done) {
      util.run(function(server) {
        SocketServer = server;
        fs = MakeDrive.fs({forceCreate: true, manual: true, provider: new Filer.FileSystem.providers.Memory(testUtils.username())});
        sync = fs.sync;
        done();
      });
    });

    afterEach(function(done){
      testUtils.disconnectClient(sync, function(err) {
        if(err) throw err;

        sync = null;
        fs = null;
        done();
      });
    });

    it('should send a "RESPONSE" of "AUTHORIZED" which triggers an initial downstream sync', function(done) {
      util.authenticateAndRun(sync, function(client, message) {
        validateSocketMessage(message, SyncMessage.response.authz);
        done();
      });
    });

    it('should send a "REQUEST" for "DIFFS" containing checksums when requested for checksums for a path under the sync root', function(done) {
      var file = {path: '/file', content: 'This is a file'};
      var checksumRequest = SyncMessage.request.checksums;
      checksumRequest.content = {path: file.path, type: syncTypes.CREATE, sourceList: testUtils.generateSourceList([file])};

      util.authenticateAndRun(sync, function(client) {
        client.once('message', function(message) {
          var expectedMessage = SyncMessage.request.diffs;
          expectedMessage.content = {path: file.path, type: syncTypes.CREATE, checksums: FAKE_DATA};
          validateSocketMessage(message, expectedMessage, ['checksums']);
          done();
        });

        client.send(checksumRequest.stringify());
      });
    });

    it('should send a "RESPONSE" of "ROOT" when requested for checksums for a path not under the sync root', function(done) {
      var file = {path: '/file', content: 'This is a file'};
      var checksumRequest = SyncMessage.request.checksums;
      checksumRequest.content = {path: file.path, type: syncTypes.CREATE, sourceList: testUtils.generateSourceList([file])};

      fs.mkdir('/dir', function(err) {
        if(err) throw err;

        fs.setRoot('/dir', function(err) {
          if(err) throw err;

          util.authenticateAndRun(sync, function(client) {
            client.once('message', function(message) {
              var expectedMessage = SyncMessage.response.root;
              expectedMessage.content = {path: file.path, type: syncTypes.CREATE};
              validateSocketMessage(message, expectedMessage);
              done();
            });

            client.send(checksumRequest.stringify());
          });
        });
      });
    });

    it('should patch the file being synced and send a "RESPONSE" of "PATCH" if the file was not changed during the sync', function(done) {
      var file = {path: '/file', content: 'This is a file'};
      var diffResponse = SyncMessage.response.diffs;
      diffResponse.content = {path: file.path, type: syncTypes.CREATE, diffs: diffHelper.serialize(testUtils.generateDiffs([file]))};
      var layout = {};
      layout[file.path] = file.content;

      util.authenticateAndRun(sync, function(client) {
        client.once('message', function(message) {
          var expectedMessage = SyncMessage.response.patch;
          expectedMessage.content = {path: file.path, type: syncTypes.CREATE, checksum: testUtils.generateValidationChecksums([file])};
          validateSocketMessage(message, expectedMessage);
          testUtils.ensureFilesystem(fs, layout, function(err) {
            expect(err).not.to.exist;
            done();
          });
        });

        client.send(diffResponse.stringify());
      });
    });

    it('should not patch the file being synced and send a "REQUEST" for "DIFFS" with checksums if the file was changed during the sync', function(done) {
      var file = {path: '/file', content: 'This is a file'};
      var checksumRequest = SyncMessage.request.checksums;
      checksumRequest.content = {path: file.path, type: syncTypes.CREATE, sourceList: testUtils.generateSourceList([file])};
      var diffResponse = SyncMessage.response.diffs;
      diffResponse.content = {path: file.path, type: syncTypes.CREATE, diffs: diffHelper.serialize(testUtils.generateDiffs([file]))};
      var layout = {};
      layout[file.path] = 'This file was changed';

      util.authenticateAndRun(sync, function(client) {
        client.once('message', function() {
          fs.writeFile(file.path, layout[file.path], function(err) {
            if(err) throw err;

            client.once('message', function(message) {
              var expectedMessage = SyncMessage.request.diffs;
              expectedMessage.content = {path: file.path, type: syncTypes.CREATE, checksums: FAKE_DATA};
              validateSocketMessage(message, expectedMessage, ['checksums']);
              testUtils.ensureFilesystem(fs, layout, function(err) {
                expect(err).not.to.exist;
                done();
              });
            });

            client.send(diffResponse.stringify());
          });
        });

        client.send(checksumRequest.stringify());
      });
    });

    it('should emit a completed event on completing a downstream sync', function(done) {
      var file = {path: '/file', content: 'This is a file'};
      var verificationResponse = SyncMessage.response.verification;
      verificationResponse.content = {path: file.path};

      util.authenticateAndRun(sync, function(client) {
        sync.once('completed', function(path) {
          expect(path).to.equal(file.path);
          done();
        });

        client.send(verificationResponse.stringify());
      });
    });
  });

  describe('Upstream syncs', function() {
    var fs;
    var sync;

    beforeEach(function(done) {
      util.run(function(server) {
        SocketServer = server;
        fs = MakeDrive.fs({forceCreate: true, manual: true, provider: new Filer.FileSystem.providers.Memory(testUtils.username())});
        sync = fs.sync;
        done();
      });
    });

    afterEach(function(done){
      testUtils.disconnectClient(sync, function(err) {
        if(err) throw err;

        sync = null;
        fs = null;
        done();
      });
    });

    it('should send a "REQUEST" for "SYNC" if a sync is requested and there are changes to the filesystem', function(done) {
      var file = {path: '/file', content: 'This is a file'};

      util.authenticateAndRun(sync, function(client) {
        fs.writeFile(file.path, file.content, function(err) {
          if(err) throw err;

          client.once('message', function(message) {
            var expectedMessage = SyncMessage.request.sync;
            expectedMessage.content = {path: file.path, type: syncTypes.CREATE};

            validateSocketMessage(message, expectedMessage);
            done();
          });

          sync.request();
        });
      });
    });

    it('should emit an interrupted and syncing event when an upstream sync is requested for a file that has not been downstreamed', function(done) {
      var file = {path: '/file', content: 'This is a file'};
      var downstreamError = SyncMessage.error.needsDownstream;
      downstreamError.content = {path: file.path, type: syncTypes.CREATE};
      var checksumRequest = SyncMessage.request.checksums;
      checksumRequest.content = {path: file.path, type: syncTypes.CREATE, sourceList: testUtils.generateSourceList([file])};
      var errorEventEmitted = false;
      var assertionsCompleted = false;

      function endTest() {
        if(assertionsCompleted) {
          done();
        } else {
          assertionsCompleted = true;
        }
      }

      util.authenticateAndRun(sync, function(client) {
        fs.writeFile(file.path, file.content, function(err) {
          if(err) throw err;

          client.once('message', function() {
            sync.once('error', function(err) {
              errorEventEmitted = true;

              client.once('message', endTest);

              expect(err).to.exist;
              expect(err.message).to.equal('Sync interrupted for path ' + file.path);
              client.send(checksumRequest.stringify());
            });
            sync.once('syncing', function(message) {
              expect(message).to.equal('Sync started for ' + file.path);
              expect(errorEventEmitted).to.be.true;
              endTest();
            });

            client.send(downstreamError.stringify());
          });

          sync.request();
        });
      });
    });

    it('should trigger a syncing event and send a "REQUEST" for "CHECKSUMS" when the request to sync has been approved', function(done) {
      var file = {path: '/file', content: 'This is a file'};
      var syncResponse = SyncMessage.response.sync;
      syncResponse.content = {path: file.path, type: syncTypes.CREATE};

      util.authenticateAndRun(sync, function(client) {
        fs.writeFile(file.path, file.content, function(err) {
          if(err) throw err;

          client.once('message', function(message) {
            var expectedMessage = SyncMessage.request.checksums;
            expectedMessage.content = {path: file.path, type: syncTypes.CREATE, sourceList: FAKE_DATA};
            validateSocketMessage(message, expectedMessage, ['sourceList']);
            done();
          });

          sync.once('syncing', function(message) {
            expect(message).to.equal('Sync started for ' + file.path);
          });

          client.send(syncResponse.stringify());
        });
      });
    });

    it('should send a "RESPONSE" of "DIFFS" when requested for diffs', function(done) {
      var file = {path: '/file', content: 'This is a file'};
      var diffRequest = SyncMessage.request.diffs;
      diffRequest.content = {path: file.path, type: syncTypes.CREATE, checksums: testUtils.generateChecksums([file])};

      util.authenticateAndRun(sync, function(client) {
        fs.writeFile(file.path, file.content, function(err) {
          if(err) throw err;

          client.once('message', function(message) {
            var expectedMessage = SyncMessage.response.diffs;
            expectedMessage.content = {path: file.path, type: syncTypes.CREATE, diffs: FAKE_DATA};
            validateSocketMessage(message, expectedMessage, ['diffs']);
            done();
          });

          client.send(diffRequest.stringify());
        });
      });
    });

    it('should emit a completed and synced event when all upstream syncs are completed', function(done) {
      var file = {path: '/file', content: 'This is a file'};
      var patchResponse = SyncMessage.response.patch;
      patchResponse.content = {path: file.path, type: syncTypes.CREATE};
      var completedEventEmitted = false;

      util.authenticateAndRun(sync, function(client) {
        fs.writeFile(file.path, file.content, function(err) {
          if(err) throw err;

          sync.once('synced', function() {
            expect(completedEventEmitted).to.be.true;
            done();
          });
          sync.once('error', incorrectEvent);
          sync.once('completed', function(path) {
            expect(path).to.equal(file.path);
            completedEventEmitted = true;
          });

          client.send(patchResponse.stringify());
        });
      });
    });

    it('should automatically trigger the next upstream sync in the queue once an upstream sync finishes', function(done) {
      var file = {path: '/file', content: 'This is a file'};
      var file2 = {path: '/file2', content: 'This is another file'};
      var patchResponse = SyncMessage.response.patch;
      patchResponse.content = {path: file.path, type: syncTypes.CREATE};

      util.authenticateAndRun(sync, function(client) {
        fs.writeFile(file.path, file.content, function(err) {
          if(err) throw err;

          fs.writeFile(file2.path, file2.content, function(err) {
            if(err) throw err;

            client.once('message', function(message) {
              var expectedMessage = SyncMessage.request.sync;
              expectedMessage.content = {path: file2.path, type: syncTypes.CREATE};
              validateSocketMessage(message, expectedMessage);
              done();
            });

            client.send(patchResponse.stringify());
          });
        });
      });
    });

    it('should emit an error event when a sync is requested while another upstream sync is occurring', function(done) {
      var file = {path: '/file', content: 'This is a file'};

      util.authenticateAndRun(sync, function(client) {
        fs.writeFile(file.path, file.content, function(err) {
          if(err) throw err;

          sync.once('error', function(err) {
            expect(err).to.exist;
            expect(err.message).to.equal('Sync currently underway');
            done();
          });

          client.once('message', function() {
            sync.request();
          });

          sync.request();
        });
      });
    });
  });
});
