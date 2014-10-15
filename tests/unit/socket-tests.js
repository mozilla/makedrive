var expect = require('chai').expect;
var util = require('../lib/util.js');
var SyncMessage = require('../../lib/syncmessage');

describe('[Downstream Syncing with Websockets]', function(){
  describe('The server', function(){
    it('should close a socket if bad data is sent in place of websocket-auth token', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        var gotMessage = false;

        var socketPackage = util.openSocket({
          onMessage: function() {
            gotMessage = true;
          },
          onClose: function() {
            expect(gotMessage).to.be.false;
            util.cleanupSockets(result.done, socketPackage);
          },
          onOpen: function() {
            socketPackage.socket.send("this-is-garbage");
          }
        });
      });
    });

    it('shouldn\'t allow the same token to be used twice', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            message = util.toSyncMessage(message);

            expect(message).to.exist;
            expect(message.type).to.equal(SyncMessage.REQUEST);
            expect(message.name).to.equal(SyncMessage.CHKSUM);
            expect(message.content).to.be.an('object');

            var socketPackage2 = util.openSocket(socketData, {
              onClose: function(code) {
                expect(code).to.equal(1008);
                util.cleanupSockets(result.done, socketPackage, socketPackage2);
              }
            });
          }
        });
      });
    });

    it(', after receiving a valid token and syncId, should send a RESPONSE named "AUTHZ"', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket({
          onMessage: function(message) {
            expect(message).to.equal(SyncMessage.response.authz.stringify());
            util.cleanupSockets(result.done, socketPackage);
          },
          onOpen: function() {
            socketPackage.socket.send(JSON.stringify(socketData));
          }
        });
      });
    });

    it('should allow two socket connections for the same username from different clients', function(done) {
      util.authenticatedConnection(function( err, result ) {
        expect(err).not.to.exist;
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            message = util.toSyncMessage(message);
            expect(message).to.exist;
            expect(message.type).to.equal(SyncMessage.REQUEST);
            expect(message.name).to.equal(SyncMessage.CHKSUM);
            expect(message.content).to.be.an('object');

            util.authenticatedConnection({username: result.username}, function(err, result2) {
              expect(err).not.to.exist;
              socketData = {
                syncId: result2.syncId,
                token: result2.token
              };

              var socketPackage2 = util.openSocket(socketData, {
                onMessage: function() {
                  util.cleanupSockets(function() {
                    result.done();
                    result2.done();
                    done();
                  }, socketPackage, socketPackage2);
                },
              });
            });
          }
        });
      });
    });

    it('should send an "implementation" SyncMessage error object when a non-syncmessage object is sent', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        expect(err).not.to.exist;

        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            // First, confirm server acknowledgment
            message = util.toSyncMessage(message);
            expect(message).to.exist;
            expect(message.type).to.equal(SyncMessage.REQUEST);
            expect(message.name).to.equal(SyncMessage.CHKSUM);
            expect(message.content).to.be.an('object');

            // Listen for SyncMessage error
            socketPackage.socket.on("message", function(message) {
              var implMsg = SyncMessage.error.impl;
              implMsg.content = { error: "The Sync message cannot be handled by the server" };

              expect(message).to.equal(implMsg.stringify());
              util.cleanupSockets(result.done, socketPackage);
            });

            var invalidMessage = {
              anything: "else"
            };

            socketPackage.socket.send(JSON.stringify(invalidMessage));
          }
        });
      });
    });

    it('should allow an initial downstream sync for a new client after an upstream sync has been started', function(done) {
      // First client connects
      util.authenticatedConnection({done: done}, function(err, result1) {
        expect(err).not.to.exist;

        // Second client connects
        util.authenticatedConnection({username: result1.username}, function(err, result2) {
          expect(err).not.to.exist;

          // First client completes the initial downstream sync & begins an upstream sync
          util.prepareUpstreamSync('requestSync', result1.username, result1.token, function(data1, fs1, socketPackage1){

            // Second client attempts an initial downstream sync
            util.completeDownstreamSync(result1.username, result2.token, function(err, data2, fs2, socketPackage2) {
              expect(err).not.to.exist;

              util.cleanupSockets(function() {
                result1.done();
                result2.done();
              }, socketPackage1, socketPackage2);
            });
          });
        });
      });
    });

    it('should block a downstream sync reset request from the client after an upstream sync has been started', function(done) {
      // First client connects
      util.authenticatedConnection({done: done}, function(err, result1) {
        expect(err).not.to.exist;

        // Second client connects
        util.authenticatedConnection({username: result1.username}, function(err, result2) {
          expect(err).not.to.exist;

          // First client completes the initial downstream sync
          util.prepareUpstreamSync(result1.username, result1.token, function(err, data1, fs1, socketPackage1){
            expect(err).not.to.exist;

            // Second client begins an upstream sync
            util.prepareUpstreamSync('requestSync', result1.username, result2.token, function(data2, fs2, socketPackage2) {
              // First client sends RESPONSE RESET to start a downstream sync on the first client and expect an error
              util.downstreamSyncSteps.requestSync(socketPackage1, data1, fs1, function(msg, cb) {
                msg = util.toSyncMessage(msg);

                expect(msg).to.exist;
                expect(msg.type).to.equal(SyncMessage.ERROR);
                expect(msg.name).to.equal(SyncMessage.DOWNSTREAM_LOCKED);

                cb();
              }, function() {
                util.cleanupSockets(function() {
                  result1.done();
                  result2.done();
                }, socketPackage1, socketPackage2);
              });
            });
          });
        });
      });
    });

    it('should block a downstream sync diffs request from the client after an upstream sync has been started', function(done) {
      // First client connects
      util.authenticatedConnection({done: done}, function(err, result1) {
        expect(err).not.to.exist;

        // Second client connects
        util.authenticatedConnection({username: result1.username}, function(err, result2) {
          expect(err).not.to.exist;

          // First client completes the initial downstream sync
          util.prepareUpstreamSync(result1.username, result1.token, function(err, data1, fs1, socketPackage1){
            expect(err).not.to.exist;

            // First client completes the first step of a downstream sync
            util.downstreamSyncSteps.requestSync(socketPackage1, data1, fs1, function(err, downstreamData) {
              expect(err).to.not.exist;

              // Second client begins an upstream sync
              util.prepareUpstreamSync('requestSync', result1.username, result2.token, function(data2, fs2, socketPackage2) {
                // First client attempts the second step of an downstream sync, expecting an error
                util.downstreamSyncSteps.generateDiffs(socketPackage1, downstreamData, fs1, function(msg, cb) {
                  msg = util.toSyncMessage(msg);

                  expect(msg).to.exist;
                  expect(msg.type).to.equal(SyncMessage.ERROR);
                  expect(msg.name).to.equal(SyncMessage.DOWNSTREAM_LOCKED);

                  cb();
                }, function() {
                  util.cleanupSockets(function(){
                    result1.done();
                    result2.done();
                  }, socketPackage1, socketPackage2);
                });
              });
            });
          });
        });
      });
    });

    it('should allow the patch verification from the client after an upstream sync has been started', function(done) {
      // First client connects
      util.authenticatedConnection({done: done}, function(err, result1) {
        expect(err).not.to.exist;

        // Second client connects
        util.authenticatedConnection({username: result1.username}, function(err, result2) {
          expect(err).not.to.exist;

          // First client completes the initial downstream sync
          util.prepareUpstreamSync(result1.username, result1.token, function(err, data1, fs1, socketPackage1){
            expect(err).not.to.exist;

            // First client completes the first step of a downstream sync
            util.downstreamSyncSteps.requestSync(socketPackage1, data1, fs1, function(err, downstreamData) {
              expect(err).to.not.exist;

              // First client completes the second step of a downstream sync
              util.downstreamSyncSteps.generateDiffs(socketPackage1, downstreamData, fs1, function(err, downstreamData2) {
                expect(err).to.not.exist;

                // Second client begins an upstream sync
                util.prepareUpstreamSync('requestSync', result1.username, result2.token, function(data2, fs2, socketPackage2) {

                  // First client attempts the final step of an downstream sync, expect all to be well.
                  util.downstreamSyncSteps.patchClientFilesystem(socketPackage1, downstreamData2, fs1, function(err) {
                    expect(err).to.not.exist;

                    util.cleanupSockets(function(){
                      result1.done();
                      result2.done();
                    }, socketPackage1, socketPackage2);
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  describe('Generate Diffs', function() {
    it('should return an RESPONSE message with the diffs', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareDownstreamSync(result.username, result.token, function(err, syncData, fs, socketPackage) {
          util.downstreamSyncSteps.generateDiffs(socketPackage, syncData, fs, function(msg, cb) {
            msg = util.toSyncMessage(msg);

            expect(msg.type, "[Message type error: \"" + (msg.content && msg.content.error) +"\"]" ).to.equal(SyncMessage.RESPONSE);
            expect(msg.name).to.equal(SyncMessage.DIFFS);
            expect(msg.content).to.exist;
            expect(msg.content.diffs).to.exist;
            cb();
          }, function() {
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });

    it('should return an ERROR type message named DIFFS when faulty checksums are sent', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareDownstreamSync(result.username, result.token, function(err, syncData, fs, socketPackage) {
          var diffRequest = SyncMessage.request.diffs;
          diffRequest.content = {
            checksums: "jargon"
          };
          util.sendSyncMessage(socketPackage, diffRequest, function(msg) {
            msg = util.toSyncMessage(msg);

            expect(msg.type, "[Message type error: \"" + (msg.content && msg.content.error) +"\"]" ).to.equal(SyncMessage.ERROR);
            expect(msg.name).to.equal(SyncMessage.DIFFS);
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });

    it('should return an SyncMessage with error content when no checksums are sent', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareDownstreamSync(result.username, result.token, function(err, syncData, fs, socketPackage) {
          var diffRequest = SyncMessage.request.diffs;
          util.sendSyncMessage(socketPackage, diffRequest, function(msg) {
            msg = util.toSyncMessage(msg);

            expect(msg).to.eql(SyncMessage.error.content);
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
  });

  describe('Patch the client filesystem', function() {
    it('should make the server respond with a RESPONSE SYNC SyncMessage after ending a downstream sync, and initiating an upstream sync', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareDownstreamSync('generateDiffs', result.username, result.token, function(err, syncData, fs, socketPackage) {
          util.downstreamSyncSteps.patchClientFilesystem(socketPackage, syncData, fs, function(msg, cb) {
            msg = util.toSyncMessage(msg);
            var startSyncMsg = SyncMessage.request.sync;
            startSyncMsg.content = {path: '/'};
            util.sendSyncMessage(socketPackage, startSyncMsg, function(message){
              message = util.toSyncMessage(message);

              expect(message).to.exist;
              expect(message.type).to.equal(SyncMessage.RESPONSE);
              expect(message.name).to.equal(SyncMessage.SYNC);

              cb();
            });
          }, function() {
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });

    it('should return an IMPLEMENTATION ERROR SyncMessage when sent out of turn', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareDownstreamSync(result.username, result.token, function(err, data, fs, socketPackage) {
          var startSyncMsg = SyncMessage.request.sync;
          startSyncMsg.content = {path: '/'};
          util.sendSyncMessage(socketPackage, startSyncMsg, function(msg){
            msg = util.toSyncMessage(msg);

            expect(msg).to.exist;
            expect(msg.type).to.equal(SyncMessage.ERROR);
            expect(msg.name).to.equal(SyncMessage.IMPL);
            expect(msg.content).to.exist;
            expect(msg.content.error).to.exist;

            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
  });

  describe('Request checksums', function() {
    it('should return a CONTENT error SyncMessage if srcList isn\'t passed', function(done) {
      // Authorize a user, open a socket, authorize and complete a downstream sync
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareUpstreamSync('requestSync', result.username, result.token, function(syncData, fs, socketPackage) {
          var requestChksumMsg = SyncMessage.request.chksum;
          requestChksumMsg.content = {
            path: syncData.path
          };
          socketPackage.socket.send(requestChksumMsg.stringify());

          util.sendSyncMessage(socketPackage, requestChksumMsg, function(msg) {
            msg = util.toSyncMessage(msg);

            expect(msg).to.deep.equal(SyncMessage.error.content);

            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
    it('should return a CONTENT error SyncMessage if no data is passed', function(done) {
      // Authorize a user, open a socket, authorize and complete a downstream sync
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareUpstreamSync('requestSync', result.username, result.token, function(syncData, fs, socketPackage) {
          var requestChksumMsg = SyncMessage.request.chksum;
          requestChksumMsg.content = {};
          socketPackage.socket.send(requestChksumMsg.stringify());

          util.sendSyncMessage(socketPackage, requestChksumMsg, function(msg) {
            msg = util.toSyncMessage(msg);

            expect(msg).to.deep.equal(SyncMessage.error.content);

            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
  });
});
