var expect = require('chai').expect;
var util = require('../../lib/util.js');
var server = require('../../lib/server-utils.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');

describe('MakeDrive Client API', function(){
  before(function(done) {
    server.start(done);
  });
  after(function(done) {
    server.shutdown(done);
  });

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
      expect(MakeDrive.Buffer).to.be.a('function');
      expect(MakeDrive.Path).to.exist;
      expect(MakeDrive.Path.normalize).to.be.a('function');
      expect(MakeDrive.Errors).to.exist;

      // MakeDrive.fs()
      expect(MakeDrive.fs).to.be.a('function');
      var fs = MakeDrive.fs({memory: true, manual: true});
      var fs2 = MakeDrive.fs({memory: true, manual: true});
      expect(fs).to.equal(fs2);

      // MakeDrive.fs().sync property
      expect(fs.sync).to.exist;
      expect(fs.sync.on).to.be.a('function');
      expect(fs.sync.connect).to.be.a('function');
      expect(fs.sync.disconnect).to.be.a('function');
      expect(fs.sync.request).to.be.a('function');
      expect(fs.sync.manual).to.be.a('function');
      expect(fs.sync.auto).to.be.a('function');

      // Sync States
      expect(fs.sync.SYNC_DISCONNECTED).to.equal("SYNC DISCONNECTED");
      expect(fs.sync.SYNC_CONNECTING).to.equal("SYNC CONNECTING");
      expect(fs.sync.SYNC_CONNECTED).to.equal("SYNC CONNECTED");
      expect(fs.sync.SYNC_SYNCING).to.equal("SYNC SYNCING");
      expect(fs.sync.state).to.equal(fs.sync.SYNC_DISCONNECTED);
    });

    it('should allow passing options to Filer from MakeDrive.fs(options)', function(done) {
      var fs = MakeDrive.fs({
        forceCreate: true,
        provider: provider,
        flags: ['FORMAT', 'NOATIME', 'NOCTIME', 'NOMTIME'],
      });

      // Since we set custom flags to disable time stamps,
      // any fs access should leave the times unchanged.
      fs.stat('/', function(err, stats) {
        if(err) throw err;

        // Remember the original mtime on the root dir
        var rootMTIME = stats.mtime;

        // Write a file within /, which will update the root dir
        fs.writeFile('/file', 'data', function(err) {
          if(err) throw err;

          // Make sure the mtime on / is the same as before
          fs.stat('/', function(err, stats) {
            if(err) throw err;

            expect(stats.mtime).to.equal(rootMTIME);
            done();
          });
        });
      });

    });

    /**
     * This test goes through the complete process of syncing with the server.
     * It starts by connecting, then writes a file and tries to sync. The
     * various sync events are observed, then it disconnects, and finally
     * checks that the file was uploaded.
     */
    it('should go through proper steps with connect(), request(), disconnect()', function(done) {
      server.authenticatedConnection(function(err, result) {
        expect(err).not.to.exist;

        var token = result.token;

        var layout = {'/file': 'data'};

        var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true, autoReconnect: false});
        var sync = fs.sync;

        var everSeenSyncing = false;
        var everSeenCompleted = false;
        var everSeenError = false;

        sync.once('connected', function onConnected() {
          expect(sync.state).to.satisfy(function(state) {
            return state === sync.SYNC_CONNECTED || state === sync.SYNC_SYNCING;
          });

          // Write a file and try to sync
          util.createFilesystemLayout(fs, layout, function(err) {
            expect(err).not.to.exist;
            sync.request();
          });
        });

        sync.once('syncing', function onUpstreamSyncing() {
          expect(sync.state).to.satisfy(function(state) {
            return state === sync.SYNC_CONNECTED || state === sync.SYNC_SYNCING;
          });

          everSeenSyncing = true;
        });

        sync.once('synced', function onUpstreamCompleted() {
          everSeenCompleted = sync.state;

          // Confirm file was really uploaded and remote fs matches what we expect
          server.ensureRemoteFilesystem(layout, result.jar, function() {
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
          expect(everSeenSyncing).to.be.true;
          expect(everSeenCompleted).to.equal(sync.SYNC_CONNECTED);

          // Make sure client fs is in the same state we left it
          util.ensureFilesystem(fs, layout, done);
        });

        expect(sync.state).to.equal(sync.SYNC_DISCONNECTED);
        sync.connect(server.socketURL, token);
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
    var fs;
    var sync;

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

    it('should emit an error describing an incorrect SYNC_STATE in the sync.request step', function(done){
      server.authenticatedConnection(function( err, result ) {
        expect(err).not.to.exist;

        var token = result.token;
        var layout = {'/file': 'data'};

        sync.once('synced', function onDownstreamCompleted() {
          sync.once('disconnected', function onDisconnected() {
            sync.once('error', function(err){
              expect(err).to.exist;
              expect(err).to.deep.equal(new Error('MakeDrive error: MakeDrive cannot sync as it is either disconnected or trying to connect'));

              done();
            });

            sync.request();
          });

          // Make FS changes and try to sync
          util.createFilesystemLayout(fs, layout, function(err) {
            expect(err).not.to.exist;

            sync.disconnect();
          });
        });

        sync.connect(server.socketURL, token);
      });
    });

    it('should emit an error warning about an unexpected sync.state when calling the sync.auto step', function(done){
      server.authenticatedConnection(function(err, result) {
        expect(err).not.to.exist;

        var token = result.token;
        var layout = {'/file': 'data'};

        sync.once('synced', function onDownstreamCompleted() {
          sync.once('disconnected', function onDisconnected() {
            sync.once('error', function(err){
              expect(err).to.exist;
              expect(err).to.deep.equal(new Error('MakeDrive error: MakeDrive cannot sync as it is either disconnected or trying to connect'));

              done();
            });

            sync.auto();
          });

          // Make FS changes and try to sync
          util.createFilesystemLayout(fs, layout, function(err) {
            expect(err).not.to.exist;

            sync.disconnect();
          });
        });

        sync.connect(server.socketURL, token);
      });
    });
  });
});
