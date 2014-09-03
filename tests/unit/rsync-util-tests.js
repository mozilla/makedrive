var Filer = require('../../lib/filer.js');
var expect = require('chai').expect;
var fs;
var provider;
var CHUNK_SIZE = 5;
var rsyncUtils = require('../../lib/rsync-utils.js');

function fsInit() {
  provider = new Filer.FileSystem.providers.Memory("rsync1");
  fs = new Filer.FileSystem({
    provider: provider,
    flags: ['FORMAT']
  });
  fs2 = new Filer.FileSystem({
    provider: new Filer.FileSystem.providers.Memory("rsync2"),
    flags: ['FORMAT']
  });
}

function fsCleanup() {
  fs = null;
  fs2 = null;
  provider = null;
}

describe('[Rsync Util Tests]', function() {
  describe('Rsync PathChecksums', function() {
    beforeEach(fsInit);
    afterEach(fsCleanup);

    it('should be a function', function (done) {
      expect(rsyncUtils.pathChecksums).to.be.a.function;
      done();
    });

    it('should return an EINVAL error if a filesystem is not provided', function (done) {
      var filesystem;

      rsyncUtils.generateChecksums(filesystem, [], CHUNK_SIZE, function (err, checksums) {
        expect(err).to.exist;
        expect(err.code).to.equal('EINVAL');
        expect(checksums).to.not.exist;
        done();
      });
    });

    it('should return an EINVAL error if no paths are provided', function (done) {
      rsyncUtils.generateChecksums(fs, null, CHUNK_SIZE, function (err, checksums) {
        expect(err).to.exist;
        expect(err.code).to.equal('EINVAL');
        expect(checksums).to.not.exist;
        done();
      });
    });

    it('should return an error if chunk size is not provided', function (done) {
      rsyncUtils.generateChecksums(fs, [], null, function (err, checksums) {
        expect(err).to.exist;
        expect(err.code).to.equal('EINVAL');
        expect(checksums).to.not.exist;
        done();
      });
    });

    it('should return empty checksums if empty paths are provided', function (done) {
      rsyncUtils.generateChecksums(fs, [], CHUNK_SIZE, function (err, checksums) {
        expect(err).to.not.exist;
        expect(checksums).to.exist;
        expect(checksums).to.have.length(0);
        done();
      });
    });

    it('should return an empty checksum if the path to the node provided does not exist', function (done) {
      rsyncUtils.generateChecksums(fs, ['/myfile.txt'], CHUNK_SIZE, function (err, checksums) {
        expect(err).to.not.exist;
        expect(checksums).to.exist;
        expect(checksums).to.have.length(1);
        expect(checksums[0]).to.include.keys('checksum');
        expect(checksums[0].checksum).to.have.length(0);
        done();
      });
    });

    it('should return empty contents for a directory path', function (done) {
      fs.mkdir('/dir', function (err) {
        expect(err).to.not.exist;
        rsyncUtils.generateChecksums(fs, ['/dir'], CHUNK_SIZE, function (err, checksums) {
          expect(err).to.not.exist;
          expect(checksums).to.exist;
          expect(checksums).to.have.length(1);
          expect(checksums[0]).to.include.keys('contents');
          expect(checksums[0].contents).to.have.length(0);
          done();
        });
      });
    });

    it('should succeed generating checksums for a list of paths', function (done) {
      var paths = ['/dir1', '/dir1/myfile1.txt', '/dir1/subdir1',
                   '/dir2',
                   '/dir3', '/dir3/myfile2.txt'];

      fs.mkdir('/dir1', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/dir1/myfile1.txt', 'This is a file', function (err) {
          expect(err).to.not.exist;
          fs.mkdir('/dir2', function (err) {
            expect(err).to.not.exist;
            fs.mkdir('/dir1/subdir1', function (err) {
              expect(err).to.not.exist;
              fs.mkdir('/dir3', function (err) {
                expect(err).to.not.exist;
                fs.writeFile('/dir3/myfile2.txt', 'This is also a file', function (err) {
                  expect(err).to.not.exist;
                  rsyncUtils.generateChecksums(fs, paths, CHUNK_SIZE, function (err, checksums) {
                    expect(err).to.not.exist;
                    expect(checksums).to.exist;
                    expect(checksums).to.have.length(paths.length);
                    expect(checksums[0]).to.include.keys('contents');
                    expect(checksums[0].contents).to.have.length(2);
                    expect(checksums[0].contents).to.have.members(['myfile1.txt', 'subdir1']);
                    expect(checksums[1]).to.include.keys('checksum');
                    expect(checksums[1].checksum).to.have.length.above(0);
                    expect(checksums[2]).to.include.keys('contents');
                    expect(checksums[2].contents).to.have.length(0);
                    expect(checksums[3]).to.include.keys('contents');
                    expect(checksums[3].contents).to.have.length(0);
                    expect(checksums[4]).to.include.keys('contents');
                    expect(checksums[4].contents).to.have.length(1);
                    expect(checksums[4].contents).to.have.members(['myfile2.txt']);
                    expect(checksums[5]).to.include.keys('checksum');
                    expect(checksums[5].checksum).to.have.length.above(0);
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  describe('Rsync CompareContents', function() {
    beforeEach(fsInit);
    afterEach(fsCleanup);

    it('should be a function', function (done) {
      expect(rsyncUtils.compareContents).to.be.a.function;
      done();
    });

    it('should return an EINVAL error if a filesystem is not provided', function (done) {
      var filesystem;

      rsyncUtils.compareContents(filesystem, [], CHUNK_SIZE, function (err, equal) {
        expect(err).to.exist;
        expect(err.code).to.equal('EINVAL');
        expect(equal).to.not.exist;
        done();
      });
    });

    it('should return an EINVAL error if no checksums are provided', function (done) {
      rsyncUtils.compareContents(fs, null, CHUNK_SIZE, function (err, equal) {
        expect(err).to.exist;
        expect(err.code).to.equal('EINVAL');
        expect(equal).to.not.exist;
        done();
      });
    });

    it('should return an error if chunk size is not provided', function (done) {
      rsyncUtils.compareContents(fs, [], null, function (err, equal) {
        expect(err).to.exist;
        expect(err.code).to.equal('EINVAL');
        expect(equal).to.not.exist;
        done();
      });
    });

    it('should return true if a checksum is provided for a path that does not exist', function (done) {
      rsyncUtils.compareContents(fs, [{path: '/non-existent-file.txt', checksum: []}], CHUNK_SIZE, function (err, equal) {
        expect(err).to.not.exist;
        expect(equal).to.equal(true);
        done();
      });
    });

    it('should return true if checksums match contents for a set of paths', function (done) {
      var paths = ['/dir1', '/dir1/myfile1.txt', '/dir1/subdir1',
                   '/dir2',
                   '/dir3', '/dir3/myfile2.txt'];

      fs.mkdir('/dir1', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/dir1/myfile1.txt', 'This is a file', function (err) {
          expect(err).to.not.exist;
          fs.mkdir('/dir2', function (err) {
            expect(err).to.not.exist;
            fs.mkdir('/dir1/subdir1', function (err) {
              expect(err).to.not.exist;
              fs.mkdir('/dir3', function (err) {
                expect(err).to.not.exist;
                fs.writeFile('/dir3/myfile2.txt', 'This is also a file', function (err) {
                  expect(err).to.not.exist;
                  rsyncUtils.generateChecksums(fs, paths, CHUNK_SIZE, function (err, checksums) {
                    expect(err).to.not.exist;
                    expect(checksums).to.exist;
                    rsyncUtils.compareContents(fs, checksums, CHUNK_SIZE, function (err, equal) {
                      expect(err).to.not.exist;
                      expect(equal).to.equal(true);
                      done();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    it('should return false if checksums do not match contents for a set of paths', function (done) {
      var paths = ['/dir1', '/dir1/myfile1.txt', '/dir1/subdir1',
                   '/dir2',
                   '/dir3', '/dir3/myfile2.txt'];

      fs.mkdir('/dir1', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/dir1/myfile1.txt', 'This is a file', function (err) {
          expect(err).to.not.exist;
          fs.mkdir('/dir2', function (err) {
            expect(err).to.not.exist;
            fs.mkdir('/dir1/subdir1', function (err) {
              expect(err).to.not.exist;
              fs.mkdir('/dir3', function (err) {
                expect(err).to.not.exist;
                fs.writeFile('/dir3/myfile2.txt', 'This is also a file', function (err) {
                  expect(err).to.not.exist;
                  fs2.mkdir('/dir1', function (err) {
                    expect(err).to.not.exist;
                    fs2.writeFile('/dir1/myfile1.txt', 'This is a file', function (err) {
                      expect(err).to.not.exist;
                      fs2.mkdir('/dir2', function (err) {
                        expect(err).to.not.exist;
                        fs2.mkdir('/dir1/subdir1', function (err) {
                          expect(err).to.not.exist;
                          fs2.mkdir('/dir3', function (err) {
                            expect(err).to.not.exist;
                            fs2.writeFile('/dir3/myfile2.txt', 'This is also a filr', function (err) {
                              expect(err).to.not.exist;
                              rsyncUtils.generateChecksums(fs, paths, CHUNK_SIZE, function (err, checksums) {
                                expect(err).to.not.exist;
                                expect(checksums).to.exist;
                                rsyncUtils.generateChecksums(fs2, paths, CHUNK_SIZE, function (err, checksums2) {
                                  rsyncUtils.compareContents(fs2, checksums, CHUNK_SIZE, function (err, equal) {
                                    expect(err).to.not.exist;
                                    expect(equal).to.equal(false);
                                    done();
                                  });
                                });
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
