var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');
var SyncMessage = require('../../../lib/syncmessage')
var WebSocketServer = require('ws').Server;
var rsync = require("../../../lib/rsync");
var rsyncOptions = require('../../../lib/constants').rsyncDefaults;

describe('MakeDrive Client API', function(){
  describe('Core API', function() {
    var provider;

    beforeEach(function() {
      provider = new Filer.FileSystem.providers.Memory(util.username());
    });
    afterEach(function() {
      provider = null;
    });

    it('should have expected methods and properites', function() {
      // Bits copied from Filer
      expect(MakeDrive.Buffer).to.be.a.function;
      expect(MakeDrive.Path).to.exist;
      expect(MakeDrive.Path.normalize).to.be.a.function;
      expect(MakeDrive.Errors).to.exist;

      // MakeDrive.fs()
      expect(MakeDrive.fs).to.be.a.function;
      var fs = MakeDrive.fs({memory: true, manual: true});
      var fs2 = MakeDrive.fs({memory: true, manual: true});
      expect(fs).to.equal(fs2);

      // MakeDrive.fs().sync property
      expect(fs.sync).to.exist;
      expect(fs.sync.on).to.be.a.function;
      expect(fs.sync.off).to.be.a.function;
      expect(fs.sync.connect).to.be.a.function;
      expect(fs.sync.disconnect).to.be.a.function;
      expect(fs.sync.sync).to.be.a.function;

      // Sync States
      expect(fs.sync.SYNC_DISCONNECTED).to.equal(0);
      expect(fs.sync.SYNC_CONNECTING).to.equal(1);
      expect(fs.sync.SYNC_CONNECTED).to.equal(2);
      expect(fs.sync.SYNC_SYNCING).to.equal(3);
      expect(fs.sync.SYNC_ERROR).to.equal(4);
      expect(fs.sync.state).to.equal(fs.sync.SYNC_DISCONNECTED);
    });

    /**
     * This test goes through the complete process of syncing with the server.
     * It starts by connecting, then writes a file and tries to sync. The
     * various sync events are observed, then it disconnects, and finally
     * checks that the file was uploaded.
     */
    it('should go through proper steps with connect(), request(), disconnect()', function(done) {
      util.authenticatedConnection(function( err, result ) {
        expect(err).not.to.exist;

        var token = result.token;

        var layout = {'/file': 'data'};

        var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
        var sync = fs.sync;

        var everSeenSyncing = false;
        var everSeenCompleted = false;
        var everSeenError = false;

        sync.once('connected', function onConnected() {
          expect(sync.state).to.equal(sync.SYNC_CONNECTED);

          // Write a file and try to sync
          util.createFilesystemLayout(fs, layout, function(err) {
            expect(err).not.to.exist;
            sync.request('/');
          });
        });

        sync.once('syncing', function onUpstreamSyncing() {
          everSeenSyncing = sync.state;
        });

        sync.once('completed', function onUpstreamCompleted() {
          everSeenCompleted = sync.state;

          // Confirm file was really uploaded and remote fs matches what we expect
          util.ensureRemoteFilesystem(layout, result.jar, function() {
            sync.disconnect();
          });
        });

        sync.on('error', function onError(err) {
          // Remember any errors we see--should be none
          everSeenError = err;
        });

        sync.once('disconnected', function onDisconnected() {
          expect(everSeenError).to.be.false;

          expect(sync.state).to.equal(sync.SYNC_DISCONNECTED);
          expect(everSeenSyncing).to.equal(sync.SYNC_SYNCING);
          expect(everSeenCompleted).to.equal(sync.SYNC_CONNECTED);

          // Make sure client fs is in the same state we left it
          util.ensureFilesystem(fs, layout, done);
        });

        expect(sync.state).to.equal(sync.SYNC_DISCONNECTED);
        sync.connect(util.socketURL, token);
        expect(sync.state).to.equal(sync.SYNC_CONNECTING);
      });
    });
  });

  /**
   * This describe block tests downstream syncing to make sure that
   * the client will restart the process in case the server errors.
   * It stubs the MakeDrive server so we can control the messages being
   * sent to the client.
   */
  describe('Protocol & Error tests', function() {
    var provider;
    var socket;
    var port = 1212;

    beforeEach(function(done) {
      provider = new Filer.FileSystem.providers.Memory(util.username());

      testServer = new WebSocketServer({port: port});
      testServer.on('error', function(err){
        expect(err, "[Error creating socket server]").to.not.exist;
      });
      testServer.on('listening', function() {
        done();
      });
    });
    afterEach(function() {
      provider = null;

      if (socket) {
        socket.close();
      };
      testServer.close();
      testServer = null;
    });

    it('should restart a downstream sync on receiving a CHKSUM ERROR SyncMessage instead of a sourceList.', function(done){
      function clientLogic() {
        var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
        var sync = fs.sync;
        sync.on('error', function(err) {
          // Confirm our client-side error is emitted as expected
          expect(err).to.deep.equal(new Error('Could not sync filesystem from server'));
        })

        sync.connect("ws://0.0.0.0:" + port, "this-is-not-relevant");
      }

      // First, prepare the stub of the server.
      testServer.on('connection', function(ws){
        socket = ws;

        // Stub WS auth
        ws.once('message', function(msg, flags) {
          msg = msg.data || msg;

          try {
            msg = JSON.parse(msg);
          } catch(e) {
            expect(e, "[Error parsing fake token]").to.not.exist;
          }

          ws.once('message', function(msg, flags) {
            // The second message from the client should be a REQUEST RESET
            try {
              msg = JSON.parse(msg);
              msg = SyncMessage.parse(msg);
            } catch(e) {
              expect(e, "[Error parsing REQUEST RESET message]").to.not.exist;
            }

            expect(msg).to.deep.equal(SyncMessage.request.reset);
            done();
          });

          ws.send(SyncMessage.response.authz.stringify());
          ws.send(SyncMessage.error.srclist.stringify());
        });
      });

      clientLogic();
    });

    it('should restart a downstream sync on receiving a DIFFS ERROR SyncMessage instead of a sourceList.', function(done){
      var fs;
      var sync;

      function clientLogic() {
        fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
        sync = fs.sync;
        sync.on('error', function(err) {
          // Confirm our client-side error is emitted as expected
          expect(err).to.deep.equal(new Error('Could not sync filesystem from server'));
        })

        sync.connect("ws://0.0.0.0:" + port, "this-is-not-relevant");
      }

      // First, prepare the stub of the server.
      testServer.on('connection', function(ws){
        socket = ws;

        // Stub WS auth
        ws.once('message', function(msg, flags) {
          msg = msg.data || msg;

          try {
            msg = JSON.parse(msg);
          } catch(e) {
            expect(e, "[Error parsing fake token]").to.not.exist;
          }

          ws.once('message', function(msg, flags) {
            // The second message from the client should be a REQUEST DIFFS
            try {
              msg = JSON.parse(msg);
              msg = SyncMessage.parse(msg);
            } catch(e) {
              expect(e, "[Error parsing REQUEST DIFFS message]").to.not.exist;
            }

            expect(msg.type).to.equal(SyncMessage.REQUEST);
            expect(msg.name).to.equal(SyncMessage.DIFFS);

            ws.once('message', function(msg) {
              // The third message should be a REQUEST RESET
              try {
                msg = JSON.parse(msg);
                msg = SyncMessage.parse(msg);
              } catch(e) {
                expect(e, "[Error parsing REQUEST RESET]").to.not.exist;
              }

              expect(msg).to.deep.equal(SyncMessage.request.reset);
              done();
            });

            var diffsErrorMessage = SyncMessage.error.diffs;
            ws.send(diffsErrorMessage.stringify());
          });

          ws.send(SyncMessage.response.authz.stringify());
          rsync.sourceList(fs, '/', rsyncOptions, function(err, srcList) {
            expect(err, "[SourceList generation error]").to.not.exist;
            var chksumRequest = SyncMessage.request.chksum;
            chksumRequest.content = {
              srcList: srcList,
              path: '/'
            };

            ws.send(chksumRequest.stringify());
          });
        });
      });

      clientLogic();
    });
  });
});
