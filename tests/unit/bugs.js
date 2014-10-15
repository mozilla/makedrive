var expect = require('chai').expect;
var util = require('../lib/util.js');
var SyncMessage = require('../../lib/syncmessage');
var MakeDrive = require('../../client/src');
var Filer = require('../../lib/filer.js');
var fsUtils = require('../../lib/fs-utils.js');

describe("Server bugs", function() {
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
});

describe('Client bugs', function() {
  var provider;

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
  });
  afterEach(function() {
    provider = null;
  });

  describe('[Issue 372]', function(){
    /**
     * This test creates a file and sync then disconenct
     * and change the file's content then try to connect and sync again.
     */
    it('should upstream newer changes made when disconnected and not create a conflicted copy', function(done) {
      var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
      var sync = fs.sync;
      var jar;

      util.authenticatedConnection(function(err, result) {
        if(err) throw err;

        var layout = {'/hello': 'hello',
                      '/dir/world': 'world'
                     };
        jar = result.jar;

        sync.once('connected', function onConnected() {
          util.createFilesystemLayout(fs, layout, function(err) {
            if(err) throw err;

            sync.request();
          });
        });

        sync.once('completed', function onUpstreamCompleted() {
          sync.disconnect();
        });

        sync.once('disconnected', function onDisconnected() {
          // Re-sync with server and make sure we get our empty dir back
          sync.once('connected', function onSecondDownstreamSync() {
            layout['/hello'] = 'hello world';

            util.ensureFilesystem(fs, layout, function(err) {
              expect(err).not.to.exist;
            });
          });

          sync.once('completed', function reconnectedUpstream() {
            util.ensureRemoteFilesystem(layout, jar, function(err) {
              expect(err).not.to.exist;
              done();
            });
          });

          util.ensureRemoteFilesystem(layout, jar, function(err) {
            if(err) throw err;

            fs.writeFile('/hello', 'hello world', function (err) {
              if(err) throw err;

              fsUtils.isPathUnsynced(fs, '/hello', function(err, unsynced) {
                if(err) throw err;

                expect(unsynced).to.be.true;

                // Get a new token for this second connection
                util.getWebsocketToken(result, function(err, result) {
                  if(err) throw err;

                  jar = result.jar;
                  sync.connect(util.socketURL, result.token);
                });
              });
            });
          });
        });

        sync.connect(util.socketURL, result.token);
      });
    });
  });
});
