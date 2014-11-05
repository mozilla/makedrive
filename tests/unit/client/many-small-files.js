var expect = require('chai').expect;
var util = require('../../lib/util.js');
var server = require('../../lib/server-utils.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client - sync many small files', function(){
  var fs;
  var sync;

  before(function(done) {
    server.start(done);
  });
  after(function(done) {
    server.shutdown(done);
  });

  beforeEach(function() {
    fs = MakeDrive.fs({provider: new Filer.FileSystem.providers.Memory(util.username()), manual: true, forceCreate: true});
    sync = fs.sync;
  });
  afterEach(function(done) {
    util.disconnectClient(sync, function(err) {
      if(err) throw err;

      sync = null;
      fs = null;
      done();
    });
  });

  function smallFile(number) {
    return '<!doctype html> '+
           '<head> '+
            '<meta charset="utf-8"> '+
             '<title> Small File ' + number + ' </title> '+
           '</head> '+
           '<body> '+
             '<p>This is small file ' + number + '.</p> '+
           '</body> '+
           '</html>';
  }

  /**
   * This test creates 100 small files in a dir, syncs, and checks that
   * they exist on the server. It then removes them, and makes sure a
   * downstream sync brings them back.
   */
  it('should sync many small files', function(done) {
    server.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      // Make a layout with /project and 100 small html files inside
      var layout = {};
      for(var i=0; i<100; i++) {
        layout['/project/small-file' + i + '.html'] = smallFile(i);
      }

      sync.once('synced', function onDownstreamCompleted() {
        sync.once('synced', function onUpstreamCompleted() {
          server.ensureRemoteFilesystem(layout, result.jar, function(err) {
            expect(err).not.to.exist;
            sync.disconnect();
          });
        });

        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;
          expect(sync.state).to.equal(sync.SYNC_CONNECTED);
          sync.request();
        });
      });

      sync.once('error', function onError(err){
        expect(err).not.to.exist;
      });

      sync.once('disconnected', function onDisconnected() {
        util.deleteFilesystemLayout(fs, null, function(err) {
          expect(err).not.to.exist;

          // Re-sync with server and make sure we get our deep dir back
          sync.once('synced', function onSecondDownstreamSync() {

            sync.once('disconnected', function onSecondDisconnected() {
              util.ensureFilesystem(fs, layout, function(err) {
                expect(err).not.to.exist;

                done();
              });
            });

            sync.disconnect();
          });

          // Get a new token for this second connection
          server.getWebsocketToken(result, function(err, result) {
            expect(err).not.to.exist;

            sync.connect(server.socketURL, result.token);
          });
        });
      });

      sync.connect(server.socketURL, result.token);
    });
  });

});
