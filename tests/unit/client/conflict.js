/*jshint expr: true*/

var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');
var SyncFileSystem = require('../../../client/src/sync-filesystem.js');
var conflict = require('../../../lib/conflict.js');

describe('MakeDrive Client Conflicts', function(){
  var fs;

  beforeEach(function(done) {
    var _fs = new Filer.FileSystem({provider: new Filer.FileSystem.providers.Memory(util.username())});
    fs = new SyncFileSystem(_fs);

    // Write one dir and one file
    fs.mkdir('/dir', function(err) {
      if(err) throw err;

      fs.writeFile('/dir/file', 'data', function(err) {
        if(err) throw err;

        done();
      });
    });
  });
  afterEach(function() {
    fs = null;
  });

  function expectConflicted(path, callback) {
    conflict.isConflictedCopy(fs, path, function(err, conflicted) {
      expect(err).not.to.exist;
      expect(conflicted).to.be.true;

      callback();
    });
  }

  it('should have required functions', function() {
    expect(conflict.filenameContainsConflicted).to.be.a.function;
    expect(conflict.isConflictedCopy).to.be.a.function;
    expect(conflict.makeConflictedCopy).to.be.a.function;
    expect(conflict.removeFileConflict).to.be.a.function;
  });

  it('should properly check for conflicted paths', function() {
    expect(conflict.filenameContainsConflicted('/')).to.be.false;
    expect(conflict.filenameContainsConflicted('/README')).to.be.false;
    expect(conflict.filenameContainsConflicted('/dir/file')).to.be.false;
    expect(conflict.filenameContainsConflicted('/My Documents')).to.be.false;
    expect(conflict.filenameContainsConflicted('/Conflicted Copy')).to.be.false;
    expect(conflict.filenameContainsConflicted('/index.html')).to.be.false;
    expect(conflict.filenameContainsConflicted('./')).to.be.false;
    expect(conflict.filenameContainsConflicted('../../Conflicted/Copy')).to.be.false;
    expect(conflict.filenameContainsConflicted('./Conflicted.copy.html')).to.be.false;

    expect(conflict.filenameContainsConflicted('index (Conflicted Copy 2014-07-23 12:00:00).html')).to.be.true;
    expect(conflict.filenameContainsConflicted('/dir/index (Conflicted Copy 2014-07-23 12:00:00).html')).to.be.true;
    expect(conflict.filenameContainsConflicted('./dir/index (Conflicted Copy 2014-07-23 12:00:00).html')).to.be.true;
    expect(conflict.filenameContainsConflicted('../../dir/index (Conflicted Copy 2014-07-23 12:00:00).html')).to.be.true;
    expect(conflict.filenameContainsConflicted('../../dir/index (Conflicted Copy 2014-07-23 12:00:00)')).to.be.true;
    expect(conflict.filenameContainsConflicted('../../Conflicted/Copy (Conflicted Copy 2014-07-23 12:00:00).html')).to.be.true;
  });

  it('should set conflicted and change filename when markConficted() is called', function(done) {
    conflict.isConflictedCopy(fs, '/dir/file', function(err, conflicted) {
      if(err) throw err;

      expect(conflicted).to.be.false;

      conflict.makeConflictedCopy(fs, '/dir/file', function(err, conflictedPath) {
        if(err) throw err;

        expect(conflict.filenameContainsConflicted(conflictedPath)).to.be.true;

        // Make sure the original file was renamed
        fs.exists('/dir/file', function(exists) {
          expect(exists).to.be.true;

          fs.exists(conflictedPath, function(exists) {
            expect(exists).to.be.true;

            conflict.isConflictedCopy(fs, conflictedPath, function(err, conflicted) {
              if(err) throw err;

              expect(conflicted).to.be.true;
              done();
            });
          });
        });
      });
    });
  });

  it('should remove conflict with removeFileConflict()', function(done) {
    conflict.isConflictedCopy(fs, '/dir/file', function(err, conflicted) {
      if(err) throw err;

      expect(conflicted).to.be.false;

      conflict.makeConflictedCopy(fs, '/dir/file', function(err, conflictedPath) {
        if(err) throw err;

        expect(conflict.filenameContainsConflicted(conflictedPath)).to.be.true;

        conflict.removeFileConflict(fs, conflictedPath, function(err) {
          if(err) throw err;

          conflict.isConflictedCopy(fs, conflictedPath, function(err, conflicted) {
            if(err) throw err;

            expect(conflicted).to.be.false;
            done();
          });
        });
      });
    });
  });

  it('should error when passing directory path to makeConflictedCopy()', function(done) {
    conflict.makeConflictedCopy(fs, '/dir', function(err, conflictedPath) {
      expect(err).to.exist;
      expect(err.code).to.equal('EPERM');

      done();
    });
  });

  it('should remove conflicted attribute when renaming', function(done) {
    conflict.isConflictedCopy(fs, '/dir/file', function(err, conflicted) {
      if(err) throw err;

      expect(conflicted).to.be.false;

      conflict.makeConflictedCopy(fs, '/dir/file', function(err, conflictedPath) {
        if(err) throw err;

        expect(conflict.filenameContainsConflicted(conflictedPath)).to.be.true;

        conflict.isConflictedCopy(fs, conflictedPath, function(err, conflicted) {
          if(err) throw err;

          expect(conflicted).to.be.true;

          fs.rename(conflictedPath, '/dir/backup', function(err) {
            if(err) throw err;

            conflict.isConflictedCopy(fs, '/dir/backup', function(err, conflicted) {
              if(err) throw err;

              expect(conflicted).to.be.false;
              done();
            });
          });
        });
      });
    });
  });

});
