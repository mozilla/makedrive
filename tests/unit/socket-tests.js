var expect = require('chai').expect;
var util = require('../lib/util.js');
var request = require('request');
var WebSocket = require('ws');
var SyncMessage = require('../../server/lib/syncmessage');

describe('Test initial socket connection', function(){
  it('should close the socket if bad data is sent in place of syncId', function( done ) {
    util.authenticatedConnection( { done: done }, function( err, result ) {
      expect(err).not.to.exist;

      var gotMessage = false;

      var ws = util.openSocket({
        onMessage: function() {
          gotMessage = true;
        },
        onClose: function() {
          expect(gotMessage).to.be.false;
          result.done();
        },
        onOpen: function() {
          ws.send("this-is-garbage");
        }
      });
    });
  });

  it('should receive an ACK when a syncId is sent', function( done ) {
    util.authenticatedConnection( { done: done }, function( err, result ) {
      expect(err).not.to.exist;

      var ws = util.openSocket({
        onMessage: function(message) {
          expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));
          result.done();
        },
        onOpen: function() {
          ws.send(JSON.stringify({syncId: result.syncId }));
        }
      });
    });
  });

  it('should open two connections for the same username from different clients', function( done ) {
    util.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      var ws = util.openSocket({
        onMessage: function(message) {
          expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));

          util.authenticatedConnection(function(err, result2) {
            expect(err).not.to.exist;

            var ws = util.openSocket({
              onMessage: function(message) {
                expect(message).to.equal(JSON.stringify(new SyncMessage(SyncMessage.RESPONSE, SyncMessage.ACK)));
                result.done();
                result2.done();
                done();
              },
              onOpen: function() {
                ws.send(JSON.stringify({syncId: result.syncId}));
              }
            })
          });
        },
        onOpen: function() {
          ws.send(JSON.stringify({syncId: result.syncId}));
        }
      });
    });
  });
});
