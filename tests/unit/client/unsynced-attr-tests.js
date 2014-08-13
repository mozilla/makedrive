/*jshint expr: true*/

var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');
var fsUtils = require('../../../lib/fs-utils.js');
var FILE_CONTENT = 'This is a file';
var async = require('async');

describe('MakeDrive Client FileSystem Unsynced Attribute', function() {
  var provider;

  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory(util.username());
  });
  afterEach(function() {
    provider = null;
  });

  // Check whether a list of paths have the unsynced attribute attached
  // The 'unsynced' flag indicates what to check for. true makes sure that
  // the paths have the unsynced attribute while false makes sure that they don't.
  function checkUnsyncedAttr(fs, layout, expected, callback) {
    var error;
    var paths = Object.keys(layout);

    function isUnsynced(path, callback) {
      fsUtils.isPathUnsynced(fs, path, function(err, hasAttr) {
        if(err) {
          error = err;
          return callback(false);
        }

        callback(expected === hasAttr);
      });
    }

    async.every(paths, isUnsynced, function(result) {
      if(error) {
        return callback(error);
      }

      callback(null, result);
    });
  }

  it('should remove unsynced attribute from all nodes after an upstream sync', function(done) {
    util.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
      var sync = fs.sync;

      var layout = { '/dir/myfile1.txt': FILE_CONTENT,
                     '/myfile2.txt': FILE_CONTENT,
                     '/dir/subdir/myfile3.txt': FILE_CONTENT
                   };

      sync.once('connected', function onConnected() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          // Check that the unsynced attribute is attached to the new nodes
          checkUnsyncedAttr(fs, layout, true, function(err, unsynced) {
            expect(err).to.not.exist;
            expect(unsynced).to.be.true;

            sync.request();
          });
        });
      });

      sync.once('completed', function onUpstreamCompleted() {
        util.ensureRemoteFilesystem(layout, result.jar, function(err) {
          expect(err).not.to.exist;

          // Check that the unsynced attribute is absent in the synced nodes
          checkUnsyncedAttr(fs, layout, false, function(err, synced) {
            expect(err).to.not.exist;
            expect(synced).to.be.true;

            done();
          });
        });
      });

      sync.connect(util.socketURL, result.token);
    });
  });

  it('should remove unsynced attributes for unsynced nodes only after an upstream sync', function (done) {
    util.authenticatedConnection(function(err, result) {
      expect(err).not.to.exist;

      var fs = MakeDrive.fs({provider: provider, manual: true, forceCreate: true});
      var sync = fs.sync;

      var layout = { '/dir/myfile1.txt': FILE_CONTENT,
                     '/myfile2.txt': FILE_CONTENT,
                     '/dir/subdir/myfile3.txt': FILE_CONTENT
                   };
      var newLayout = { '/dir/subdir/myfile3.txt': 'New content' };

      sync.once('connected', function onConnected() {
        util.createFilesystemLayout(fs, layout, function(err) {
          expect(err).not.to.exist;

          sync.request();
        });
      });

      sync.once('completed', function onUpstreamCompleted() {
        util.ensureRemoteFilesystem(layout, result.jar, function(err) {
          expect(err).not.to.exist;

          sync.once('completed', function onSecondUpstreamCompleted() {
            // Add the synced path back to the 'synced' layout
            for(var k in newLayout) layout[k] = newLayout[k];

            util.ensureRemoteFilesystem(layout, result.jar, function(err) {
              expect(err).not.to.exist;

              // Check that no file has the unsynced attribute
              checkUnsyncedAttr(fs, layout, false, function(err, synced) {
                expect(err).not.to.exist;
                expect(synced).to.be.true;

                done();
              });
            });
          });

          fs.writeFile('/dir/subdir/myfile3.txt', 'New content', function(err) {
            if(err) throw err;

            // Check that the changed unsynced file has the unsynced attribute
            checkUnsyncedAttr(fs, newLayout, true, function(err, unsynced) {
              expect(err).not.to.exist;
              expect(unsynced).to.be.true;

              // Remove the unsynced path from the 'synced' layout
              for(var k in newLayout) delete layout[k];

              // Check that the synced files do not have the unsynced attribute
              checkUnsyncedAttr(fs, layout, false, function(err, synced) {
                expect(err).not.to.exist;
                expect(synced).to.be.true;

                sync.request();
              });
            });
          });
        });
      });

      sync.connect(util.socketURL, result.token);
    });
  });
});
