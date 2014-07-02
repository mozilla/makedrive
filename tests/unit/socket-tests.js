var expect = require('chai').expect;
var util = require('../lib/util.js');
var SyncMessage = require('../../server/lib/syncmessage');
var Sync = require('../../server/lib/sync');

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
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            var socketPackage2 = util.openSocket(socketData, {
              onClose: function(code, reason) {
                expect(code).to.equal(1008);
                util.cleanupSockets(result.done, socketPackage, socketPackage2);
              }
            });
          }
        });
      });
    });
    it('should send an ACK when a syncId and the websocket auth token is sent from the client', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));
            util.cleanupSockets(result.done, socketPackage);
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
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.authenticatedConnection(function(err, result2) {
              expect(err).not.to.exist;
              socketData = {
                syncId: result2.syncId,
                token: result2.token
              };

              var socketPackage2 = util.openSocket(socketData, {
                onMessage: function(message) {
                  expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));
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
    it('should send an "invalid content" SyncMessage error object when a SyncMessage is sent with no content', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        expect(err).not.to.exist;
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            // First, confirm server acknowledgment
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            // Listen for SyncMessage error
            socketPackage.socket.on("message", function(message) {
              expect(message).to.equal(JSON.stringify(Sync.socket.errors.EINVDT));
              util.cleanupSockets(result.done, socketPackage);
            });

            var noContentMessage = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.DIFF);
            noContentMessage.content = null;

            socketPackage.socket.send(JSON.stringify(noContentMessage));
          }
        });
      });
    });
    it('should send an "invalid data" SyncMessage error object when a non-syncmessage object is sent', function(done) {
      util.authenticatedConnection({ done: done }, function(err, result) {
        expect(err).not.to.exist;
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            // First, confirm server acknowledgment
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            // Listen for SyncMessage error
            socketPackage.socket.on("message", function(message) {
              expect(message).to.equal(JSON.stringify(Sync.socket.errors.EINVAL));
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
  });
  describe('SOURCE_LIST requests', function() {
    it('should still return a SyncMessage with the sourceList and path for a sync when requested a second time', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            var username = util.username();

            util.prepareSync(username, socketPackage, function(syncData, fs) {
              util.syncSteps.srcList(socketPackage, function(data1) {
                expect(data1.srcList).to.exist;
                expect(data1.path).to.exist;

                util.syncSteps.srcList(socketPackage, function(data2) {
                  expect(data1.srcList).to.exist;
                  expect(data1.path).to.exist;

                  util.cleanupSockets(result.done, socketPackage);
                });
              });
            });
          }
        });
      });
    });
    it('should return a ESTATE SyncMessage when sent out of turn', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(util.resolveFromJSON(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            var username = util.username();

            util.prepareSync("checksums", username, socketPackage, function(syncData, fs) {
              util.syncSteps.srcList(socketPackage, function(msg, cb) {
                expect(util.resolveFromJSON(msg)).to.equal(util.resolveFromJSON(Sync.socket.errors.ESTATE));
                cb();
              }, function(data) {
                util.cleanupSockets(result.done, socketPackage);
              });
            });
          }
        });
      });
    });
  });
  describe('CHECKSUM responses', function() {
    it('should return an ACK message with the sync path when sent successfully', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(util.resolveFromJSON(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync('srcList', username, socketPackage, function(syncData, fb) {
              util.syncSteps.checksums(socketPackage, syncData, function(msg, cb) {
                var ackMsg = new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK);
                ackMsg.content = {};
                ackMsg.content.path = syncData.path;

                expect(msg).to.equal(util.resolveFromJSON(ackMsg));
                cb();
              }, function(data) {
                util.cleanupSockets(result.done, socketPackage);
              });
            });
          }
        });
      });
    });
    it('should return an ERSRSC SyncMessage when sent out of turn', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(util.resolveFromJSON(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync(username, socketPackage, function(syncData, fs){
              util.syncSteps.checksums(socketPackage, syncData, function(msg, cb) {
                expect(msg).to.equal(util.resolveFromJSON(Sync.socket.errors.ERSRSC));
                cb();
              }, function(data) {
                util.cleanupSockets(result.done, socketPackage);
              });
            });
          }
        });
      });
    });
  });
  describe('DIFF requests', function() {
    it('should return an RESPONSE message with the diffs', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(util.resolveFromJSON(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync('checksums', username, socketPackage, function(syncData, fs) {
              util.syncSteps.diffs(socketPackage, syncData, fs, function(msg, cb) {
                msg = util.resolveToJSON(msg);

                expect(msg.content).to.exist;
                expect(msg.content.diffs).to.exist;
                cb();
              }, function(data) {
                util.cleanupSockets(result.done, socketPackage);
              });
            });
          }
        });
      });
    });
    it('should return an ESTATE SyncMessage when sent out of turn', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        var username = util.username();
        var socketData = {
          token: result.token
        };

        var socketPackage = util.openSocket(socketData, {
          onMessage: function(message) {
            expect(message).to.equal(util.resolveFromJSON(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

            util.prepareSync('srcList', username, socketPackage, function(syncData, fs) {
              util.syncSteps.diffs(socketPackage, syncData, fs, function(msg, cb){
                expect(msg).to.equal(util.resolveFromJSON(Sync.socket.errors.ESTATE));
                cb();
              }, function(data) {
                util.cleanupSockets(result.done, socketPackage);
              });
            });
          }
        });
      });
    });
  });
});
