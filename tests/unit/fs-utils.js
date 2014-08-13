/*jshint expr: true*/

var expect = require('chai').expect;
var util = require('../lib/util.js');
var MakeDrive = require('../../client/src');
var Filer = require('../../lib/filer.js');
var FileSystem = Filer.FileSystem;
var fsUtils = require('../../lib/fs-utils.js');

describe('MakeDrive fs-utils.js', function(){
  var fs;

  beforeEach(function(done) {
    fs = new FileSystem({provider: new FileSystem.providers.Memory(util.username())});

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

  function expectMakeDriveUnsyncedAttribForPath(path, callback) {
    fs.getUnsynced(path, function(err, unsynced) {
      expect(err).not.to.exist;
      expect(unsynced).to.be.true;

      callback();
    });
  }

  function expectMakeDriveUnsyncedAttribForFD(fd, callback) {
    fs.fgetUnsynced(fd, function(err, unsynced) {
      expect(err).not.to.exist;
      expect(unsynced).to.be.true;

      callback();
    });
  }

  it('should have all the expected properties', function() {
    expect(fsUtils.forceCopy).to.be.a.function;
    expect(fsUtils.isPathUnsynced).to.be.a.function;
    expect(fsUtils.removeUnsynced).to.be.a.function;
    expect(fsUtils.fremoveUnsynced).to.be.a.function;
    expect(fsUtils.setUnsynced).to.be.a.function;
    expect(fsUtils.fsetUnsynced).to.be.a.function;
    expect(fsUtils.getUnsynced).to.be.a.function;
    expect(fsUtils.fgetUnsynced).to.be.a.function;
  });

  it('should copy an existing file on forceCopy()', function(done) {
    fsUtils.forceCopy(fs, '/dir/file', '/dir/file2', function(err) {
      expect(err).not.to.exist;

      fs.readFile('/dir/file2', 'utf8', function(err, data) {
        if(err) throw err;

        expect(data).to.equal('data');
        done();
      });
    });
  });

  it('should overwrite an existing file on forceCopy()', function(done) {
    fs.writeFile('/dir/file2', 'different data', function(err) {
      if(err) throw err;

      fsUtils.forceCopy(fs, '/dir/file2', '/dir/file', function(err) {
        expect(err).not.to.exist;

        fs.readFile('/dir/file', 'utf8', function(err, data) {
          if(err) throw err;

          expect(data).to.equal('different data');
          done();
        });
      });
    });
  });

  it('should report false for isPathUnsynced() if path does not exist', function(done) {
    fsUtils.isPathUnsynced(fs, '/no/such/file', function(err, unsynced) {
      expect(err).not.to.exist;
      expect(unsynced).to.be.false;
      done();
    });
  });

  it('should report false for isPathUnsynced() if path has no metadata', function(done) {
    fsUtils.isPathUnsynced(fs, '/dir/file', function(err, unsynced) {
      expect(err).not.to.exist;
      expect(unsynced).to.be.false;
      done();
    });
  });

  it('should report true for isPathUnsynced() if path has unsynced metadata', function(done) {
    fsUtils.setUnsynced(fs, '/dir/file', function(err) {
      expect(err).not.to.exist;

      fsUtils.isPathUnsynced(fs, '/dir/file', function(err, unsynced) {
        expect(err).not.to.exist;
        expect(unsynced).to.be.true;
        done();
      });
    });
  });

  it('should give date for getUnsynced() if path has unsynced metadata', function(done) {
    fsUtils.setUnsynced(fs, '/dir/file', function(err) {
      expect(err).not.to.exist;

      fsUtils.getUnsynced(fs, '/dir/file', function(err, unsynced) {
        expect(err).not.to.exist;
        expect(unsynced).to.be.a.number;
        done();
      });
    });
  });

  it('should remove metadata when calling removeUnsynced()', function(done) {
    fsUtils.setUnsynced(fs, '/dir/file', function(err) {
      expect(err).not.to.exist;

      fsUtils.getUnsynced(fs, '/dir/file', function(err, unsynced) {
        expect(err).not.to.exist;
        expect(unsynced).to.be.a.number;

        fsUtils.removeUnsynced(fs, '/dir/file', function(err) {
          expect(err).not.to.exist;

          fsUtils.getUnsynced(fs, '/dir/file', function(err, unsynced) {
            expect(err).not.to.exist;
            expect(unsynced).not.to.exist;
            done();
          });
        });
      });
    });
  });

  it('should work with fd vs. path', function(done) {
    fs.open('/dir/file', 'w', function(err, fd) {
      if(err) throw err;

      fsUtils.fsetUnsynced(fs, fd, function(err) {
        expect(err).not.to.exist;

        fsUtils.fgetUnsynced(fs, fd, function(err, unsynced) {
          expect(err).not.to.exist;
          expect(unsynced).to.be.a.number;

          fsUtils.fremoveUnsynced(fs, fd, function(err) {
            expect(err).not.to.exist;

            fsUtils.fgetUnsynced(fs, fd, function(err, unsynced) {
              expect(err).not.to.exist;
              expect(unsynced).not.to.exist;

              fs.close(fd);
              done();
            });
          });
        });
      });
    });
  });

});
