var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');
var SyncMessage = require('../../../lib/syncmessage.js');
var rsync = require('../../../lib/rsync.js');
var WebSocketServer = require('ws').Server;
var rsyncOptions = require('../../../lib/constants').rsyncDefaults;

describe('[Interruptions during a sync]', function() {
  describe('Filesystem changes', function() {
    var provider;
    var socket;
    var port = 1212;
    var testServer;

    beforeEach(function(done) {
      provider = new Filer.FileSystem.providers.Memory(util.username());
      testServer = new WebSocketServer({port: port});

      testServer.once('error', function(err){
        expect(err, "[Error creating socket server]").to.not.exist;
      });
      testServer.once('listening', function() {
        done();
      });
    });
    afterEach(function() {
      provider = null;

      if (socket) {
        socket.close();
      }

      testServer.close();
      testServer = null;
    });

    function parseMessage(msg) {
      msg = msg.data || msg;

      msg = JSON.parse(msg);
      msg = SyncMessage.parse(msg);

      return msg;
    }

    function endTestSession(sync, done) {
      sync.once('disconnected', function() {
        sync = null;
        done();
      });

      sync.disconnect();
    }

    it('should trigger a downstream reset if they occur during a downstream sync', function(done) {
      var fs;
      var sync;

      function clientLogic() {
        fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
        sync = fs.sync;

        sync.connect("ws://0.0.0.0:" + port);
      }

      // First, prepare the stub of the server.
      testServer.on('connection', function(ws){
        socket = ws;

        // Stub WS auth
        ws.once('message', function(msg, flags) {
          msg = msg.data || msg;
          msg = parseMessage(msg);

          // after auth
          ws.once('message', function(msg, flags){
            msg = parseMessage(msg);
            expect(msg).to.deep.equal(SyncMessage.response.authz);

            ws.once('message', function(msg, flags) {
              // The second message from the client should be a REQUEST DIFFS
              msg = parseMessage(msg);
              expect(msg.type).to.equal(SyncMessage.REQUEST);
              expect(msg.name).to.equal(SyncMessage.DIFFS);

              fs.writeFile('/newfile.txt', 'This changes the file system', function(err) {
                if(err) throw err;

                rsync.diff(fs, '/', msg.content.checksums, rsyncOptions, function(err, diffs) {
                  if(err) throw err;

                  var message = SyncMessage.response.diffs;

                  ws.once('message', function(msg) {
                    // The client should resend checksums and request diffs
                    msg = parseMessage(msg);
                    expect(msg.type).to.equal(SyncMessage.REQUEST);
                    expect(msg.name).to.equal(SyncMessage.DIFFS);
                    endTestSession(sync, done);
                  });

                  message.content = {diffs: diffs};
                  ws.send(message.stringify());
                });
              });
            });

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

          ws.send(SyncMessage.response.authz.stringify());
        });
      });

      clientLogic();
    });
  });
});
