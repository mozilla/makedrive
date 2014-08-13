/*jshint expr: true*/

var expect = require('chai').expect;
var util = require('../lib/util.js');
var SyncMessage = require('../../lib/syncmessage');

describe("[Issue 169]", function() {
  it("The server shouldn't crash when two clients connect on the same session.", function(done){
    util.authenticatedConnection(function( err, connectionData ) {
      expect(err).not.to.exist;
      var socketData = {
        token: connectionData.token
      };

      var socketPackage = util.openSocket(socketData, {
        onMessage: function(message) {
          message = util.toSyncMessage(message);
          expect(message).to.exist;
          expect(message.type).to.equal(SyncMessage.REQUEST);
          expect(message.name).to.equal(SyncMessage.CHKSUM);
          expect(message.content).to.be.an('object');

          expect(err).not.to.exist;

          util.getWebsocketToken(connectionData, function(err, socketData2) {
            expect(err).to.not.exist;

            var socketPackage2 = util.openSocket(socketData2, {
              onMessage: function(message) {
                util.cleanupSockets(function() {
                  connectionData.done();
                  done();
                }, socketPackage, socketPackage2);
              },
            });
          });
        }
      });
    });
  });
});
