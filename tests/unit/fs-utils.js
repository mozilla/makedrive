var expect = require('chai').expect;
var util = require('../lib/util.js');
var Filer = require('../../lib/filer.js');
var FileSystem = Filer.FileSystem;
var fsUtils = require('../../lib/fs-utils.js');
var CHECKSUM = require('MD5')('This is data').toString();

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

  it('should have all the expected properties', function() {
    expect(fsUtils.forceCopy).to.be.a('function');
    expect(fsUtils.isPathUnsynced).to.be.a('function');
    expect(fsUtils.removeUnsynced).to.be.a('function');
    expect(fsUtils.fremoveUnsynced).to.be.a('function');
    expect(fsUtils.setUnsynced).to.be.a('function');
    expect(fsUtils.fsetUnsynced).to.be.a('function');
    expect(fsUtils.getUnsynced).to.be.a('function');
    expect(fsUtils.fgetUnsynced).to.be.a('function');
    expect(fsUtils.removeChecksum).to.be.a('function');
    expect(fsUtils.fremoveChecksum).to.be.a('function');
    expect(fsUtils.setChecksum).to.be.a('function');
    expect(fsUtils.fsetChecksum).to.be.a('function');
    expect(fsUtils.getChecksum).to.be.a('function');
    expect(fsUtils.fgetChecksum).to.be.a('function');
    expect(fsUtils.isPathPartial).to.be.a('function');
    expect(fsUtils.removePartial).to.be.a('function');
    expect(fsUtils.fremovePartial).to.be.a('function');
    expect(fsUtils.setPartial).to.be.a('function');
    expect(fsUtils.fsetPartial).to.be.a('function');
    expect(fsUtils.getPartial).to.be.a('function');
    expect(fsUtils.fgetPartial).to.be.a('function');
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

  it('should work with fd vs. path for unsynced metadata', function(done) {
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

  it('should give checksum for getChecksum() if path has checksum metadata', function(done) {
    fsUtils.setChecksum(fs, '/dir/file', CHECKSUM, function(err) {
      expect(err).not.to.exist;

      fsUtils.getChecksum(fs, '/dir/file', function(err, checksum) {
        expect(err).not.to.exist;
        expect(checksum).to.equal(CHECKSUM);
        done();
      });
    });
  });

  it('should remove checksum metadata when calling removeChecksum()', function(done) {
    fsUtils.setChecksum(fs, '/dir/file', CHECKSUM, function(err) {
      expect(err).not.to.exist;

      fsUtils.getChecksum(fs, '/dir/file', function(err, checksum) {
        expect(err).not.to.exist;
        expect(checksum).to.equal(CHECKSUM);

        fsUtils.removeChecksum(fs, '/dir/file', function(err) {
          expect(err).not.to.exist;

          fsUtils.getChecksum(fs, '/dir/file', function(err, checksum) {
            expect(err).not.to.exist;
            expect(checksum).not.to.exist;
            done();
          });
        });
      });
    });
  });

  it('should work with fd vs. path for checksum metadata', function(done) {
    fs.open('/dir/file', 'w', function(err, fd) {
      if(err) throw err;

      fsUtils.fsetChecksum(fs, fd, CHECKSUM, function(err) {
        expect(err).not.to.exist;

        fsUtils.fgetChecksum(fs, fd, function(err, checksum) {
          expect(err).not.to.exist;
          expect(checksum).to.equal(CHECKSUM);

          fsUtils.fremoveChecksum(fs, fd, function(err) {
            expect(err).not.to.exist;

            fsUtils.fgetChecksum(fs, fd, function(err, checksum) {
              expect(err).not.to.exist;
              expect(checksum).not.to.exist;

              fs.close(fd);
              done();
            });
          });
        });
      });
    });
  });

  it('should report false for isPathPartial() if path does not exist', function(done) {
    fsUtils.isPathPartial(fs, '/no/such/file', function(err, partial) {
      expect(err).not.to.exist;
      expect(partial).to.be.false;
      done();
    });
  });

  it('should report false for isPathPartial() if path has no metadata', function(done) {
    fsUtils.isPathPartial(fs, '/dir/file', function(err, partial) {
      expect(err).not.to.exist;
      expect(partial).to.be.false;
      done();
    });
  });

  it('should report true for isPathPartial() if path has partial metadata', function(done) {
    fsUtils.setPartial(fs, '/dir/file', 15, function(err) {
      expect(err).not.to.exist;

      fsUtils.isPathPartial(fs, '/dir/file', function(err, partial) {
        expect(err).not.to.exist;
        expect(partial).to.be.true;
        done();
      });
    });
  });

  it('should give node count for getPartial() if path has partial metadata', function(done) {
    fsUtils.setPartial(fs, '/dir/file', 10, function(err) {
      expect(err).not.to.exist;

      fsUtils.getPartial(fs, '/dir/file', function(err, partial) {
        expect(err).not.to.exist;
        expect(partial).to.equal(10);
        done();
      });
    });
  });

  it('should remove metadata when calling removePartial()', function(done) {
    fsUtils.setPartial(fs, '/dir/file', 10, function(err) {
      expect(err).not.to.exist;

      fsUtils.getPartial(fs, '/dir/file', function(err, partial) {
        expect(err).not.to.exist;
        expect(partial).to.equal(10);

        fsUtils.removePartial(fs, '/dir/file', function(err) {
          expect(err).not.to.exist;

          fsUtils.getPartial(fs, '/dir/file', function(err, partial) {
            expect(err).not.to.exist;
            expect(partial).not.to.exist;
            done();
          });
        });
      });
    });
  });

  it('should work with fd vs. path for partial metadata', function(done) {
    fs.open('/dir/file', 'w', function(err, fd) {
      if(err) throw err;

      fsUtils.fsetPartial(fs, fd, 10, function(err) {
        expect(err).not.to.exist;

        fsUtils.fgetPartial(fs, fd, function(err, partial) {
          expect(err).not.to.exist;
          expect(partial).to.equal(10);

          fsUtils.fremovePartial(fs, fd, function(err) {
            expect(err).not.to.exist;

            fsUtils.fgetPartial(fs, fd, function(err, unsynced) {
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
