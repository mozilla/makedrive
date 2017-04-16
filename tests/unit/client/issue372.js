var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');
var fsUtils = require('../../../lib/fs-utils.js');
var conflict = require('../../../lib/conflict.js');

describe('MakeDrive Client - Issue #372', function(){
  var provider;

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
  });
  afterEach(function() {
    provider = null;
  });

  function findConflictedFilename(entries) {
    entries.splice(entries.indexOf('hello'), 1);
    return Filer.Path.join('/', entries[0]);
  }

  /**
   * This test creates a file and sync then disconenct
   * and change the file's content then try to connect and sync again.
   */
  it('should sync and create conflicted copy', function(done) {
    util.authenticatedConnection(function( err, result ) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
      var sync = fs.sync;

      var layout = {'/hello': 'hello'};

      sync.once('connected', function onConnected() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request();
        });
      });

      sync.once('completed', function onUpstreamCompleted() {
        sync.disconnect();
      });

      sync.once('disconnected', function onDisconnected() {
        // Re-sync with server and make sure we get our empty dir back
        sync.once('connected', function onSecondDownstreamSync() {
          fs.readdir('/', function(err, entries) {
            if(err) throw err;
            expect(entries.length).to.equal(2);
            expect(entries).to.include('hello');
            // Make sure this is a real conflicted copy, both in name
            // and also in terms of attributes on the file.
            var conflictedCopyFilename = findConflictedFilename(entries);
            conflict.isConflictedCopy(fs, conflictedCopyFilename, function(err, conflicted) {
              if(err) throw err;
              expect(conflicted).to.be.true;
              // Make sure the conflicted copy has the changes we expect
              fs.readFile(conflictedCopyFilename, 'utf8', function(err, data) {
                if(err) throw err;

                // Should have the modified content
                expect(data).to.equal('hello world');
                done();
              });
            });
          });
        });
        util.ensureRemoteFilesystem(layout, result.jar, function() {
          fs.writeFile('/hello', 'hello world', 'utf8', function (error) {
            if(error) throw error;
            fsUtils.isPathUnsynced(fs, '/hello', function(err, hasAttr) {
              if(err) throw err;
              expect(hasAttr).to.be.true;
              // Get a new token for this second connection
              util.getWebsocketToken(result, function(err, result) {
                expect(err).not.to.exist;

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
