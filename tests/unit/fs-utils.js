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

/**
  it('should allow fs.truncate and mark unsynced', function(done) {
    fs.truncate('/dir/file', 1, function(err) {
      if(err) throw err;

      expectMakeDriveUnsyncedAttribForPath('/dir/file', done);
    });
  });

  it('should allow fs.ftruncate and mark unsynced', function(done) {
    fs.open('/dir/file', 'w', function(err, fd) {
      if(err) throw err;

      fs.ftruncate(fd, 1, function(err) {
        if(err) throw err;

        expectMakeDriveUnsyncedAttribForFD(fd, function() {
          fs.close(fd);
          done();
        });
      });
    });
  });

  it('should allow fs.link and mark unsynced', function(done) {
    fs.link('/dir/file', '/dir/file-link', function(err) {
      if(err) throw err;

      expectMakeDriveUnsyncedAttribForPath('/dir/file-link', done);
    });
  });

  it('should allow fs.symlink and mark unsynced', function(done) {
    fs.symlink('/dir/file', '/dir/file-symlink', function(err) {
      if(err) throw err;

      expectMakeDriveUnsyncedAttribForPath('/dir/file-symlink', done);
    });
  });

  it('should allow fs.mknod and mark unsynced', function(done) {
    fs.mknod('/dir/file-node', 'FILE', function(err) {
      if(err) throw err;

      expectMakeDriveUnsyncedAttribForPath('/dir/file-node', done);
    });
  });

  it('should allow fs.mkdir and mark unsynced', function(done) {
    fs.mkdir('/newdir', function(err) {
      if(err) throw err;

      expectMakeDriveUnsyncedAttribForPath('/newdir', done);
    });
  });

  it('should allow fs.utimes and mark unsynced', function(done) {
    var now = Date.now();
    fs.utimes('/dir/file', now, now, function(err) {
      if(err) throw err;

      expectMakeDriveUnsyncedAttribForPath('/dir/file', done);
    });
  });

  it('should allow fs.futimes and mark unsynced', function(done) {
    fs.open('/dir/file', 'w', function(err, fd) {
      if(err) throw err;

      var now = Date.now();
      fs.futimes(fd, now, now, function(err) {
        if(err) throw err;

        expectMakeDriveUnsyncedAttribForFD(fd, function() {
          fs.close(fd);
          done();
        });
      });
    });
  });

  it('should allow fs.writeFile and fs.appendFile and mark unsynced', function(done) {
    fs.writeFile('/dir/file2', 'data', function(err) {
      if(err) throw err;

      expectMakeDriveUnsyncedAttribForPath('/dir/file2', function() {

        fs.appendFile('/dir/file2', '++', function(err) {
          if(err) throw err;

          expectMakeDriveUnsyncedAttribForPath('/dir/file2', function() {

            fs.readFile('/dir/file2', 'utf8', function(err, data) {
              expect(err).not.to.exist;
              expect(data).to.equal('data++');
              done();
            });
          });
        });
      });
    });
  });

  it('should allow fs.write and mark unsynced', function(done) {
    fs.open('/dir/file2', 'w', function(err, fd) {
      if(err) throw err;

      var buf = new MakeDrive.Buffer([1, 2, 3, 4, 5, 6, 7, 8]);

      fs.write(fd, buf, 0, buf.length, 0, function(err) {
        if(err) throw err;

        expectMakeDriveUnsyncedAttribForFD(fd, function() {
          fs.close(fd);
          done();
        });
      });
    });
  });

  it('should allow fs.Shell()', function(done) {
    var sh = fs.Shell();

    // Run a shell command to make sure it's working.
    sh.rm('/dir', {recursive: true}, function(err) {
      if(err) throw err;

      fs.stat('/dir', function(err, stats) {
        expect(err).to.exist;
        expect(err.code).to.equal('ENOENT');

        done();
      });
    });
  });

  it('should remove the unsynced attrib with fs.removeUnsynced()', function(done) {
    fs.writeFile('/some-file', 'data', function(err) {
      if(err) throw err;

      expectMakeDriveUnsyncedAttribForPath('/some-file', function() {
        fs.removeUnsynced('/some-file', function(err) {
          if(err) throw err;

          fs.getUnsynced('/some-file', function(err, unsynced) {
            expect(err).not.to.exist;
            expect(unsynced).to.be.false;

            done();
          });
        });
      });
    });
  });

  it('should remove the unsynced attrib with fs.fremoveUnsynced()', function(done) {
    fs.open('/some-file', 'w', function(err, fd) {
      if(err) throw err;

      var buf = new MakeDrive.Buffer([1, 2, 3, 4, 5, 6, 7, 8]);

      fs.write(fd, buf, 0, buf.length, 0, function(err) {
        if(err) throw err;

        expectMakeDriveUnsyncedAttribForFD(fd, function() {
          fs.removeUnsynced('/some-file', function(err) {
            if(err) throw err;

            fs.fgetUnsynced(fd, function(err, unsynced) {
              expect(err).not.to.exist;
              expect(unsynced).to.be.false;

              fs.close(fd);
              done();
            });
          });
        });
      });
    });
  });
**/
});
