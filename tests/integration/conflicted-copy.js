var expect = require('chai').expect;
var util = require('../lib/util.js');
var server = require('../lib/server-utils.js');
var Filer = require('../../lib/filer.js');
var conflict = require('../../lib/conflict.js');
var fsUtils = require('../../lib/fs-utils.js');

describe('MakeDrive Client - conflicted copy integration', function(){
  var client1;
  var client2;
  var layout = {'/dir1/file1': 'data'};

  // Modify both clients' filesystems, changing the same file but with
  // different changes, and assert that changes and unsynced attrib is set.
  function modifyClients(callback) {
    function modify(fs, data, callback) {
      fs.appendFile('/dir1/file1', data, function(err) {
        if(err) throw err;

        util.ensureFilesystem(fs, {'/dir1/file1': 'data' + data}, function(err) {
          if(err) throw err;

          fsUtils.isPathUnsynced(fs, '/dir1/file1', function(err, hasAttr) {
            if(err) throw err;
            expect(hasAttr).to.be.true;
            callback();
          });
        });
      });
    }

    modify(client1.fs, '+1', function(err) {
      if(err) throw err;
      modify(client2.fs, '+2', callback);
    });
  }

  // Find a conflicted copy in set of 2 filenames by process of elimination.
  function findConflictedFilename(entries) {
    entries.splice(entries.indexOf('file1'), 1);
    return Filer.Path.join('/dir1', entries[0]);
  }

  before(function(done) {
    server.start(done);
  });
  after(function(done) {
    server.shutdown(done);
  });

  // Create 2 sync clients, do downstream syncs, then dirty both filesystems
  beforeEach(function(done) {
    server.run(function() {
      var username = util.username();

      server.setupSyncClient({username: username, layout: layout, manual: true}, function(err, client) {
        if(err) throw err;

        client1 = client;

        server.ensureRemoteFilesystem(layout, client.jar, function(err) {
          if(err) throw err;

          server.setupSyncClient({username: username, manual: true}, function(err, client) {
            if(err) throw err;

            client2 = client;

            // Make sure the initial downstream sync produced the same layout as client1
            util.ensureFilesystem(client2.fs, layout, function(err) {
              if(err) throw err;

              modifyClients(done);
            });
          });
        });
      });
    });
  });

  // Cleanly shut down both clients
  afterEach(function(done) {
    util.disconnectClient(client1.sync, function(err) {
      if(err) throw err;

      client1 = null;

      util.disconnectClient(client2.sync, function(err) {
        if(err) throw err;

        client2 = null;

        done();
      });
    });
  });

  /**
   * This test creates 2 simultaneous clients for the same user, and simulates
   * a situation where a conflicted copy should be made. It then makes sure that
   * this conflicted copy is created, and that it is not synced back to the server.
   */
  it('should handle conflicted copy in downstream and upstream syncs', function(done) {
    client2.sync.once('synced', function() {
      // Make sure we have a confliced copy now + the new file.
      client2.fs.readdir('/dir1', function(err, entries) {
        if(err) throw err;
        expect(entries.length).to.equal(2);
        expect(entries).to.include('file1');

        // Make sure this is a real conflicted copy, both in name
        // and also in terms of attributes on the file.
        var conflictedCopyFilename = findConflictedFilename(entries);
        expect(conflict.filenameContainsConflicted(conflictedCopyFilename)).to.be.true;
        conflict.isConflictedCopy(client2.fs, conflictedCopyFilename, function(err, conflicted) {
          if(err) throw err;
          expect(conflicted).to.be.true;

          // Make sure the conflicted copy has the changes we expect
          client2.fs.readFile(conflictedCopyFilename, 'utf8', function(err, data) {
            if(err) throw err;

            // Should have client2's modifications
            expect(data).to.equal('data+2');

            // Now change the filesystem, sync back to the server, and make sure the
            // conflicted copy isn't synced to the server.
            client2.fs.writeFile('/dir1/file2', 'contents of file2', function(err) {
              if(err) throw err;

              client2.sync.once('synced', function() {
                // Our server's filesystem should now look like this:
                var newLayout = {
                  // NOTE: /dir1/file1 should have client1's changes, not client2's,
                  // which are in the conflicted copy instead. Also, the conflicted
                  // copy we have locally with client2 shouldn't be on the server at all.
                  '/dir1/file1': 'data+1',
                  '/dir1/file2': 'contents of file2'
                };

                server.ensureRemoteFilesystem(newLayout, client2.jar, function(err) {
                  expect(err).not.to.exist;
                  done();
                });
              });

              client2.sync.request();
            });
          });
        });
      });
    });

    // Sync client1's change to server
    client1.sync.request();
  });

  /**
   * This test creates 2 simultaneous clients for the same user, and simulates
   * a situation where a conflicted copy should be made. It then makes sure that
   * this conflicted copy is created, and that it is not synced back to the server.
   * Next the client modifies the conflicted copy (not a rename) and makes sure this
   * also doesn't sync.
   */
  it('should not sync conflicted copy when modified (i.e., not rename)', function(done) {
    client2.sync.once('synced', function() {
      // Make sure we have a confliced copy now + the new file.
      client2.fs.readdir('/dir1', function(err, entries) {
        if(err) throw err;
        expect(entries.length).to.equal(2);
        expect(entries).to.include('file1');

        // Make sure this is a real conflicted copy, both in name
        // and also in terms of attributes on the file.
        var conflictedCopyFilename = findConflictedFilename(entries);
        expect(conflict.filenameContainsConflicted(conflictedCopyFilename)).to.be.true;
        conflict.isConflictedCopy(client2.fs, conflictedCopyFilename, function(err, conflicted) {
          if(err) throw err;
          expect(conflicted).to.be.true;

          // Make sure the conflicted copy has the changes we expect
          client2.fs.readFile(conflictedCopyFilename, 'utf8', function(err, data) {
            if(err) throw err;

            // Should have client2's modifications
            expect(data).to.equal('data+2');

            // Modify the conflicted copy without doing a rename
            client2.fs.appendFile(conflictedCopyFilename, 'more data', function(err) {
              if(err) throw err;

              // Now change the filesystem, sync back to the server, and make sure the
              // conflicted copy isn't synced to the server.
              client2.fs.writeFile('/dir1/file2', 'contents of file2', function(err) {
                if(err) throw err;

                client2.sync.once('synced', function() {
                  // Our server's filesystem should now look like this:
                  var newLayout = {
                    // NOTE: /dir1/file1 should have client1's changes, not client2's,
                    // which are in the conflicted copy instead. Also, the conflicted
                    // copy we have locally with client2 shouldn't be on the server at all.
                    '/dir1/file1': 'data+1',
                    '/dir1/file2': 'contents of file2'
                  };

                  server.ensureRemoteFilesystem(newLayout, client2.jar, function(err) {
                    expect(err).not.to.exist;
                    done();
                  });
                });

                client2.sync.request();
              });
            });
          });
        });
      });
    });

    // Sync client1's change to server
    client1.sync.request();
  });

  /**
   * This test also causes a conflicted copy to be made, renames it, which should
   * clear the conflict, then does a sync back to the server, checking that it synced.
   */
  it('should handle a rename to a conflicted copy in downstream and upstream syncs', function(done) {
    client2.sync.once('synced', function() {
      // Make sure we have a confliced copy now + the new file.
      client2.fs.readdir('/dir1', function(err, entries) {
        if(err) throw err;
        expect(entries.length).to.equal(2);
        expect(entries).to.include('file1');

        // Make sure this is a real conflicted copy, both in name
        // and also in terms of attributes on the file.
        var conflictedCopyFilename = findConflictedFilename(entries);
        expect(conflict.filenameContainsConflicted(conflictedCopyFilename)).to.be.true;
        conflict.isConflictedCopy(client2.fs, conflictedCopyFilename, function(err, conflicted) {
          if(err) throw err;
          expect(conflicted).to.be.true;

          // Make sure the conflicted copy has the changes we expect
          client2.fs.readFile(conflictedCopyFilename, 'utf8', function(err, data) {
            if(err) throw err;

            // Should have client2's modifications
            expect(data).to.equal('data+2');

            // Rename the conflicted file and re-sync with server, making
            // sure that the file gets sent this time.
            client2.fs.rename(conflictedCopyFilename, '/dir1/resolved', function(err) {
              if(err) throw err;

              // Make sure the rename removed the conflict
              conflict.isConflictedCopy(client2.fs, '/dir1/resolved', function(err, conflicted) {
                if(err) throw err;
                expect(conflicted).to.be.false;

                client2.sync.once('synced', function() {
                  // Our server's filesystem should now look like this:
                  var newLayout = {
                    // NOTE: /dir1/resolved should have client2's changes, not client1's.
                    '/dir1/file1': 'data+1',
                    '/dir1/resolved': 'data+2'
                  };

                  server.ensureRemoteFilesystem(newLayout, client2.jar, function(err) {
                    expect(err).not.to.exist;
                    done();
                  });
                });

                client2.sync.request();
              });
            });
          });
        });
      });
    });

    // Sync client1's change to server
    client1.sync.request();
  });

  it('should not fail a sync if the path modified is a conflicted copy', function(done) {
    var layout1 = {'/dir1/file1': layout['/dir1/file1'] + '+1'};
    var layout2 = {'/dir1/file1': layout1['/dir1/file1']};

    client2.sync.once('synced', function() {
      client2.fs.readdir('/dir1', function(err, entries) {
        if(err) throw err;
        expect(entries.length).to.equal(2);
        expect(entries).to.include('file1');

        // Make sure this is a real conflicted copy, both in name
        // and also in terms of attributes on the file.
        var conflictedCopyFilename = findConflictedFilename(entries);
        expect(conflict.filenameContainsConflicted(conflictedCopyFilename)).to.be.true;
        // Add the conflicted copy to the layout
        layout2[conflictedCopyFilename] = 'Changed Data';

        client2.fs.writeFile(conflictedCopyFilename, layout2[conflictedCopyFilename], function(err) {
          if(err) throw err;

          client2.sync.once('idle', function() {
            util.ensureFilesystem(client2.fs, layout2, function(err) {
              expect(err).not.to.exist;

              util.ensureFilesystem(client1.fs, layout1, function(err) {
                expect(err).not.to.exist;

                done();
              });
            });
          });

          client2.sync.request();
        });
      });
    });

    client1.sync.request();
  });
});
