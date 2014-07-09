var expect = require('chai').expect;
var util = require('../lib/util.js');
var SyncMessage = require('../../lib/syncmessage');
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
            message = util.resolveToJSON(message);
            expect(message).to.exist;
            expect(message.type).to.equal(SyncMessage.REQUEST);
            expect(message.name).to.equal(SyncMessage.CHKSUM);
            expect(message.content).to.be.an('object');

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
            socketPackage.socket.send(util.resolveFromJSON(socketData));
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
            message = util.resolveToJSON(message);
            expect(message).to.exist;
            expect(message.type).to.equal(SyncMessage.REQUEST);
            expect(message.name).to.equal(SyncMessage.CHKSUM);
            expect(message.content).to.be.an('object');

            util.authenticatedConnection(function(err, result2) {
              expect(err).not.to.exist;
              socketData = {
                syncId: result2.syncId,
                token: result2.token
              };

              var socketPackage2 = util.openSocket(socketData, {
                onMessage: function(message) {
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
            message = util.resolveToJSON(message);
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
  });
  describe('DIFFS responses', function() {
    it('should return an RESPONSE message with the diffs', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareDownstreamSync(result.username, result.token, function(syncData, fs, socketPackage) {
          util.downstreamSyncSteps.diffs(socketPackage, syncData, fs, function(msg, cb) {
            msg = util.resolveToJSON(msg);

            expect(msg.type, "[Message type error: \"" + (msg.content && msg.content.error) +"\"]" ).to.equal(SyncMessage.RESPONSE);
            expect(msg.name).to.equal(SyncMessage.DIFFS);
            expect(msg.content).to.exist;
            expect(msg.content.diffs).to.exist;
            cb();
          }, function(data) {
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
  });
  describe('PATCH', function() {
    it('should make the server respond with a RESPONSE SYNC SyncMessage after ending a downstream sync, and initiating an upstream sync', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareDownstreamSync('diffs', result.username, result.token, function(syncData, fs, socketPackage) {
          util.downstreamSyncSteps.patch(socketPackage, syncData, fs, function(msg, cb) {
            msg = util.resolveToJSON(msg);
            var startSyncMsg = SyncMessage.request.sync.stringify();
            util.sendSyncMessage(socketPackage, startSyncMsg, function(message){
              message = util.resolveToJSON(message);

              expect(message).to.exist;
              expect(message.type).to.equal(SyncMessage.RESPONSE);
              expect(message.name).to.equal(SyncMessage.SYNC);

              cb();
            });
          }, function(data) {
            util.cleanupSockets(result.done, socketPackage);
          });
        });
      });
    });
    it('should return an IMPLEMENTATION ERROR SyncMessage when sent out of turn', function(done) {
      util.authenticatedConnection({ done: done }, function( err, result ) {
        expect(err).not.to.exist;

        util.prepareDownstreamSync('diffs', result.username, result.token, function(data, fs, socketPackage) {
          var startSyncMsg = SyncMessage.request.sync;
          util.sendSyncMessage(socketPackage, startSyncMsg, function(msg){
            var msg = util.resolveToJSON(msg);

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
});
