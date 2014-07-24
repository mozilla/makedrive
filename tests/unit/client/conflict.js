var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');
var SyncFileSystem = require('../../../client/src/sync-filesystem.js');
var conflict = require('../../../lib/conflict.js');

describe('MakeDrive Client Conflicts', function(){
  var fs;

  beforeEach(function(done) {
    fs = new SyncFileSystem({provider: new Filer.FileSystem.providers.Memory(util.username())});

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
    conflict.isConflicted(fs, path, function(err, conflicted) {
      expect(err).not.to.exist;
      expect(conflicted).to.be.true;

      callback();
    });
  }

  it('should have required functions', function() {
    expect(conflict.pathContainsConflicted).to.be.a.function;
    expect(conflict.isConflicted).to.be.a.function;
    expect(conflict.markConflicted).to.be.a.function;
    expect(conflict.removeConflict).to.be.a.function;
  });

  it('should properly check for conflicted paths', function() {
    expect(conflict.pathContainsConflicted('/')).to.be.false;
    expect(conflict.pathContainsConflicted('/README')).to.be.false;
    expect(conflict.pathContainsConflicted('/dir/file')).to.be.false;
    expect(conflict.pathContainsConflicted('/My Documents')).to.be.false;
    expect(conflict.pathContainsConflicted('/Conflicted Copy')).to.be.false;
    expect(conflict.pathContainsConflicted('/index.html')).to.be.false;
    expect(conflict.pathContainsConflicted('./')).to.be.false;
    expect(conflict.pathContainsConflicted('../../Conflicted/Copy')).to.be.false;
    expect(conflict.pathContainsConflicted('./Conflicted.copy.html')).to.be.false;

    expect(conflict.pathContainsConflicted('index (Conflicted Copy 2014-07-23 12:00:00).html')).to.be.true;
    expect(conflict.pathContainsConflicted('/dir/index (Conflicted Copy 2014-07-23 12:00:00).html')).to.be.true;
    expect(conflict.pathContainsConflicted('./dir/index (Conflicted Copy 2014-07-23 12:00:00).html')).to.be.true;
    expect(conflict.pathContainsConflicted('../../dir/index (Conflicted Copy 2014-07-23 12:00:00).html')).to.be.true;
    expect(conflict.pathContainsConflicted('../../dir/index (Conflicted Copy 2014-07-23 12:00:00)')).to.be.true;
    expect(conflict.pathContainsConflicted('../../Conflicted/Copy (Conflicted Copy 2014-07-23 12:00:00).html')).to.be.true;
  });

  it('should set conflicted and change filename when markConficted() is called', function(done) {
    conflict.isConflicted(fs, '/dir/file', function(err, conflicted) {
      if(err) throw err;

      expect(conflicted).to.be.false;

      conflict.markConflicted(fs, '/dir/file', function(err, conflictedPath) {
        if(err) throw err;

        expect(conflict.pathContainsConflicted(conflictedPath)).to.be.true;

        // Make sure the original file was renamed
        fs.exists('/dir/file', function(exists) {
          expect(exists).to.be.false;

          fs.exists(conflictedPath, function(exists) {
            expect(exists).to.be.true;

            conflict.isConflicted(fs, conflictedPath, function(err, conflicted) {
              if(err) throw err;

              expect(conflicted).to.be.true;
              done();
            });
          });
        });
      });
    });
  });

  it('should remove conflict with removeConflict()', function(done) {
    conflict.isConflicted(fs, '/dir/file', function(err, conflicted) {
      if(err) throw err;

      expect(conflicted).to.be.false;

      conflict.markConflicted(fs, '/dir/file', function(err, conflictedPath) {
        if(err) throw err;

        expect(conflict.pathContainsConflicted(conflictedPath)).to.be.true;

        conflict.removeConflict(fs, conflictedPath, function(err) {
          if(err) throw err;

          conflict.isConflicted(fs, conflictedPath, function(err, conflicted) {
            if(err) throw err;

            expect(conflicted).to.be.false;
            done();
          });
        });
      });
    });
  });

});
