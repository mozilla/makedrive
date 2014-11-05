var expect = require('chai').expect;
var util = require('../lib/util.js');
var server = require('../lib/server-utils.js');
var MakeDrive = require('../../client/src');
var Filer = require('../../lib/filer.js');

describe('Two clients', function(){
  var provider1, provider2;

  before(function(done) {
    server.start(done);
  });
  after(function(done) {
    server.shutdown(done);
  });

  beforeEach(function(done) {
    server.run(function() {
      var username = util.username();
      provider1 = new Filer.FileSystem.providers.Memory(username + '_1');
      provider2 = new Filer.FileSystem.providers.Memory(username + '_2');
      done();
    });
  });
  afterEach(function() {
    provider1 = null;
    provider2 = null;
  });

  it('should be able to sync two files in one direction', function(done) {
    var file1 = {'/dir/file1.txt': 'This is file 1'};
    var file2 = {'/dir/file2.txt': 'This is file 2'};
    var finalLayout = { '/dir/file1.txt': 'This is file 1',
                        '/dir/file2.txt': 'This is file 2' };

    server.authenticatedConnection(function(err, result1) {
      expect(err).not.to.exist;

      // Filesystem and sync object of first client
      var fs1 = MakeDrive.fs({provider: provider1, manual: true, forceCreate: true});
      var sync1 = fs1.sync;

      // Step 1: First client has connected
      sync1.once('connected', function onClient1Connected() {
        server.authenticatedConnection({username: result1.username}, function(err, result2) {
          expect(err).not.to.exist;

          // Filesystem and sync object of second client
          var fs2 = MakeDrive.fs({provider: provider2, manual: true, forceCreate: true});
          var sync2 = fs2.sync;

          // Step 2: Second client has connected
          sync2.once('connected', function onClient2Connected() {
            // Step 3: First client has completed upstream sync #1
            sync1.once('synced', function onClient1Upstream1() {
              server.ensureRemoteFilesystem(file1, result1.jar, function(err) {
                expect(err).not.to.exist;
              });
            });

            // Step 4: Second client has pulled down first client's upstream patch #1
            sync2.on('completed', function onClient2Downstream1(path) {
              // Only continue if the sync was completed for
              // /dir/file1.txt, i.e. not /dir which will occur first
              if(path !== '/dir/file1.txt') {
                return;
              }

              sync2.removeListener('completed', onClient2Downstream1);

              util.ensureFilesystem(fs2, file1, function(err) {
                expect(err).not.to.exist;

                // Step 5: First client has completed upstream sync #2
                sync1.once('synced', function onClient1Upstream2() {
                  server.ensureRemoteFilesystem(finalLayout, result1.jar, function(err) {
                    expect(err).not.to.exist;
                  });
                });

                // Step 6: Second client has pulled down first client's upstream patch #2
                sync2.once('synced', function onClient2Downstream2() {
                  util.ensureFilesystem(fs2, finalLayout, function(err) {
                    expect(err).not.to.exist;

                    util.disconnectClient(sync1, function(err) {
                      if(err) throw err;

                      util.disconnectClient(sync2, done);
                    });
                  });
                });

                util.createFilesystemLayout(fs1, file2, function(err) {
                  expect(err).not.to.exist;

                  sync1.request();
                });
              });
            });

            util.createFilesystemLayout(fs1, file1, function(err) {
              expect(err).not.to.exist;

              sync1.request();
            });
          });

          sync2.connect(server.socketURL, result2.token);
        });
      });

      sync1.connect(server.socketURL, result1.token);
    });
  });
});
