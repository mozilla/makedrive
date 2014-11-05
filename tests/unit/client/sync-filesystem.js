var expect = require('chai').expect;
var util = require('../../lib/util.js');
var MakeDrive = require('../../../client/src');
var Filer = require('../../../lib/filer.js');
var fsUtils = require('../../../lib/fs-utils.js');
var SyncFileSystem = require('../../../client/src/sync-filesystem.js');

describe('MakeDrive Client SyncFileSystem', function(){
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

  function expectMakeDriveUnsyncedAttribForPath(path, callback) {
    fs.getUnsynced(path, function(err, unsynced) {
      expect(err).not.to.exist;
      expect(unsynced).to.be.a('number');

      callback();
    });
  }

  function expectMakeDriveUnsyncedAttribForFD(fd, callback) {
    fs.fgetUnsynced(fd, function(err, unsynced) {
      expect(err).not.to.exist;
      expect(unsynced).to.be.a('number');

      callback();
    });
  }

  it('should have all the usual properties of a regular fs', function() {
    expect(fs.rename).to.be.a('function');
    expect(fs.ftruncate).to.be.a('function');
    expect(fs.truncate).to.be.a('function');
    expect(fs.stat).to.be.a('function');
    expect(fs.fstat).to.be.a('function');
    expect(fs.exists).to.be.a('function');
    expect(fs.link).to.be.a('function');
    expect(fs.symlink).to.be.a('function');
    expect(fs.readlink).to.be.a('function');
    expect(fs.realpath).to.be.a('function');
    expect(fs.unlink).to.be.a('function');
    expect(fs.mknod).to.be.a('function');
    expect(fs.mkdir).to.be.a('function');
    expect(fs.readdir).to.be.a('function');
    expect(fs.close).to.be.a('function');
    expect(fs.open).to.be.a('function');
    expect(fs.utimes).to.be.a('function');
    expect(fs.futimes).to.be.a('function');
    expect(fs.fsync).to.be.a('function');
    expect(fs.write).to.be.a('function');
    expect(fs.read).to.be.a('function');
    expect(fs.readFile).to.be.a('function');
    expect(fs.writeFile).to.be.a('function');
    expect(fs.appendFile).to.be.a('function');
    expect(fs.setxattr).to.be.a('function');
    expect(fs.fsetxattr).to.be.a('function');
    expect(fs.getxattr).to.be.a('function');
    expect(fs.removexattr).to.be.a('function');
    expect(fs.fremovexattr).to.be.a('function');
    expect(fs.watch).to.be.a('function');
    expect(fs.Shell).to.be.a('function');

    // Extra SyncFileSystem specific things
    expect(fs.getUnsynced).to.be.a('function');
    expect(fs.fgetUnsynced).to.be.a('function');
  });

  it('should allow fs.rename and mark unsynced', function(done) {
    fs.readFile('/dir/file', 'utf8', function(err, data) {
      if(err) throw err;

      fs.rename('/dir/file', '/dir/file2', function(err) {
        if(err) throw err;

        fs.readFile('/dir/file2', 'utf8', function(err, data2) {
          if(err) throw err;

          expect(data2).to.equal(data);
          expectMakeDriveUnsyncedAttribForPath('/dir/file2', done);
        });
      });
    });
  });

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

  it('should allow fs.rmdir', function(done) {
    fs.mkdir('/newdir', function(err) {
      if(err) throw err;

      fs.rmdir('/newdir', function(err) {
        if(err) throw err;

        done();
      });
    });
  });

  it('should allow fs.unlink', function(done) {
    fs.writeFile('/file', 'data', function(err) {
      if(err) throw err;

      fs.unlink('/file', function(err) {
        if(err) throw err;

        done();
      });
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
    var sh = new fs.Shell();

    // Run a shell command to make sure it's working.
    sh.rm('/dir', {recursive: true}, function(err) {
      if(err) throw err;

      fs.stat('/dir', function(err) {
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
        fsUtils.removeUnsynced(fs, '/some-file', function(err) {
          if(err) throw err;

          fs.getUnsynced('/some-file', function(err, unsynced) {
            expect(err).not.to.exist;
            expect(unsynced).not.to.exist;

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
          fsUtils.removeUnsynced(fs, '/some-file', function(err) {
            if(err) throw err;

            fs.fgetUnsynced(fd, function(err, unsynced) {
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
