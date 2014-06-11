var expect = require('chai').expect;
var util = require('../lib/util.js');
var request = require('request');
var WebSocket = require('ws');
var SyncMessage = require('../../server/lib/syncmessage');
var Sync = require('../../server/lib/sync');

describe('The server', function(){
  it('should close a socket if bad data is sent in place of syncId', function( done ) {
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

  it('should send an ACK when a syncId is sent from the client', function( done ) {
    util.authenticatedConnection({ done: done }, function( err, result ) {
      expect(err).not.to.exist;

       var socketPackage = util.openSocket({
        onMessage: function(message) {
          expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));
          util.cleanupSockets(result.done, socketPackage);
        },
        onOpen: function() {
          socketPackage.socket.send(JSON.stringify({syncId: result.syncId }));
        }
      });
    });
  });

  it('should allow two socket connections for the same username from different clients', function( done ) {
    util.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      var socketPackage = util.openSocket({
        onMessage: function(message) {
          expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

          util.authenticatedConnection(function(err, result2) {
            expect(err).not.to.exist;

            var socketPackage2 = util.openSocket({
              onMessage: function(message) {
                expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));
                util.cleanupSockets(function() {
                  result.done();
                  result2.done();
                  done();
                }, socketPackage, socketPackage2);
              },
              onOpen: function() {
                socketPackage2.socket.send(JSON.stringify({syncId: result.syncId}));
              }
            });
          });
        },
        onOpen: function() {
          socketPackage.socket.send(JSON.stringify({syncId: result.syncId}));
        }
      });
    });
  });
});

describe('Downstream sync through a socket', function(){
  it('should send an error object when no data is sent with a message', function(done) {
    util.authenticatedConnection({ done: done }, function(err, result) {
      expect(err).not.to.exist;

      var socketPackage = util.openSocket({
        onOpen: function() {
          socketPackage.socket.send(JSON.stringify({syncId: result.syncId}));
        },
        onMessage: function(message) {
          expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

          // Listen for SyncMessage error
          socketPackage.socket.on("message", function(message) {
            expect(message).to.equal(JSON.stringify(Sync.ws.errors.EUNDEF()));
            util.cleanupSockets(result.done, socketPackage);
          });

          socketPackage.socket.send();
        }
      });
    });
  });
});
