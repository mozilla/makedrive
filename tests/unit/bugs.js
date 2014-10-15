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
              onMessage: function() {
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

describe('[Issue 287]', function(){
  it('should fix timing issue with server holding onto active sync for user after completed', function(done) {
    var layout = {'/dir/file.txt': 'This is file 1'};

    util.setupSyncClient({manual: true, layout: layout}, function(err, client) {
      expect(err).not.to.exist;

      var fs = client.fs;
      var sync = client.sync;

      fs.unlink('/dir/file.txt', function(err) {
        expect(err).not.to.exist;

        sync.once('completed', function() {
          sync.once('disconnected', done);
          sync.disconnect();
        });

        sync.request();
      });
    });
  });
});
