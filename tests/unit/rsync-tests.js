var OPTION_SIZE = { size: 5 };
var OPTION_REC_SIZE = { recursive: true, size: 5 };

var Filer = require('../../lib/filer.js'),
    Buffer = Filer.Buffer,
    rsync = require('../../lib/rsync'),
    expect = require('chai').expect,
    fs,
    fs2,
    provider;

describe('Rsync', function() {
  beforeEach(function() {
    provider = new Filer.FileSystem.providers.Memory("B");
    fs = new Filer.FileSystem({
      provider: provider,
      flags: ['FORMAT']
    });
    fs2 = new Filer.FileSystem({
      provider: new Filer.FileSystem.providers.Memory("A"),
      flags: ['FORMAT']
    });
  });

  afterEach(function () {
    fs = null;
    fs2 = null;
    provider = null;
  });

  it('should fail generating sourceList if filesystem is null', function (done) {
    rsync.sourceList(null, '/', function (err) {
      expect(err).to.exist;
      expect(err.code).to.equal('EINVAL');
      done();
    });
  });

  it('should fail generating checksums if filesystem is null', function (done) {
    rsync.checksums(null, '/', [], function (err) {
      expect(err).to.exist;
      expect(err.code).to.equal('EINVAL');
      done();
    });
  });

  it('should fail generating diffs if filesystem is null', function (done) {
    rsync.diff(null, '/', [], function (err) {
      expect(err).to.exist;
      expect(err.code).to.equal('EINVAL');
      done();
    });
  });

  it('should fail patching if filesystem is null', function (done) {
    rsync.patch(null, '/', [], function (err, paths) {
      expect(err).to.exist;
      expect(err.code).to.equal('EINVAL');
      expect(paths).to.exist;
      expect(paths.synced).to.have.length(0);
      done();
    });
  });

  it('should fail generating sourceList if source path is null', function (done) {
    rsync.sourceList(fs, null, function (err) {
      expect(err).to.exist;
      expect(err.code).to.equal('EINVAL');
      done();
    });
  });

  it('should fail generating checksums if source path is null', function (done) {
    rsync.checksums(fs, null, [], function (err) {
      expect(err).to.exist;
      expect(err.code).to.equal('EINVAL');
      done();
    });
  });

  it('should fail generating diffs if source path is null', function (done) {
    rsync.diff(fs, null, [], function (err) {
      expect(err).to.exist;
      expect(err.code).to.equal('EINVAL');
      done();
    });
  });

  it('should fail patching if source path is null', function (done) {
    rsync.patch(fs, null, [], function (err, paths) {
      expect(err).to.exist;
      expect(err.code).to.equal('EINVAL');
      expect(paths).to.exist;
      expect(paths.synced).to.have.length(0);
      done();
    });
  });

  it('should fail if source path doesn\'t exist', function (done) {
    rsync.sourceList(fs, '/1.txt', function (err) {
      expect(err).to.exist;
      expect(err.code).to.equal('ENOENT');
      done();
    });
  });

  it('should succeed if the source file is different in content but not length from the destination file. (Destination edited)', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/1.txt', 'This is my file. It does not have any typos.', 'utf8', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/test/1.txt', 'This iz mi fiel. It doez not have any topos,', 'utf8', function (err) {
          expect(err).to.not.exist;
          rsync.sourceList(fs, '/1.txt', OPTION_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.checksums(fs, '/test/1.txt', data, OPTION_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.diff(fs, '/1.txt', data, OPTION_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.patch(fs, '/test/1.txt', data, OPTION_SIZE, function (err, paths) {
                  expect(err).to.not.exist;
                  expect(paths).to.exist;
                  expect(paths.synced).to.have.length(1);
                  expect(paths.synced).to.have.members(['/test/1.txt']);
                  expect(paths.failed).to.have.length(0);
                  fs.readFile('/test/1.txt', 'utf8', function (err, data) {
                    expect(err).to.not.exist;
                    expect(data).to.exist;
                    expect(data).to.equal('This is my file. It does not have any typos.');
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

  it('should succeed if the source file is longer than the destination file. (Destination appended)', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/1.txt', 'This is my file. It is longer than the destination file.', 'utf8', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/test/1.txt', 'This is my file.', 'utf8', function (err) {
          expect(err).to.not.exist;
          rsync.sourceList(fs, '/1.txt', OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.checksums(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.diff(fs, '/1.txt', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.patch(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, paths) {
                  expect(err).to.not.exist;
                  expect(paths).to.exist;
                  expect(paths.synced).to.have.length(1);
                  expect(paths.synced).to.have.members(['/test/1.txt']);
                  expect(paths.failed).to.have.length(0);
                  fs.readFile('/test/1.txt', 'utf8', function (err, data) {
                    expect(err).to.not.exist;
                    expect(data).to.exist;
                    expect(data).to.equal('This is my file. It is longer than the destination file.');
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

  it('should succeed if the source file shorter than the destination file. (Destination truncated)', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/1.txt', 'This is my file.', 'utf8', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/test/1.txt', 'This is my file. It is longer than the source version.', 'utf8', function (err) {
          expect(err).to.not.exist;
          rsync.sourceList(fs, '/1.txt', OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.checksums(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.diff(fs, '/1.txt', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.patch(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, paths) {
                  expect(err).to.not.exist;
                  expect(paths).to.exist;
                  expect(paths.synced).to.have.length(1);
                  expect(paths.synced).to.have.members(['/test/1.txt']);
                  expect(paths.failed).to.have.length(0);
                  fs.readFile('/test/1.txt', 'utf8', function (err, data) {
                    expect(err).to.not.exist;
                    expect(data).to.exist;
                    expect(data).to.equal('This is my file.');
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

  it('should succeed if the source file does not exist in the destination folder (Destination file created)', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/1.txt', 'This is my file. It does not exist in the destination folder.', 'utf8', function (err) {
        expect(err).to.not.exist;
        rsync.sourceList(fs, '/1.txt', OPTION_REC_SIZE, function (err, data) {
          expect(err).to.not.exist;
          rsync.checksums(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.diff(fs, '/1.txt', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.patch(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, paths) {
                expect(err).to.not.exist;
                expect(paths).to.exist;
                expect(paths.synced).to.have.length(1);
                expect(paths.synced).to.have.members(['/test/1.txt']);
                expect(paths.failed).to.have.length(0);
                fs.readFile('/test/1.txt', 'utf8', function (err, data) {
                  expect(err).to.not.exist;
                  expect(data).to.exist;
                  expect(data).to.equal('This is my file. It does not exist in the destination folder.');
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  it('should succeed if no options are provided', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/1.txt', 'This is my file. It does not exist in the destination folder.', 'utf8', function (err) {
        expect(err).to.not.exist;
        rsync.sourceList(fs, '/1.txt', OPTION_REC_SIZE, function (err, data) {
          expect(err).to.not.exist;
          rsync.checksums(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.diff(fs, '/1.txt', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.patch(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, paths) {
                expect(err).to.not.exist;
                expect(paths).to.exist;
                expect(paths.synced).to.have.length(1);
                expect(paths.synced).to.have.members(['/test/1.txt']);
                expect(paths.failed).to.have.length(0);
                fs.readFile('/test/1.txt', 'utf8', function (err, data) {
                  expect(err).to.not.exist;
                  expect(data).to.exist;
                  expect(data).to.equal('This is my file. It does not exist in the destination folder.');
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  it('should do nothing if the source file and destination file have the same mtime and size with \'checksum = false\' flag (Default)', function (done) {
    OPTION_REC_SIZE.checksum = false;
    var date = Date.parse('1 Oct 2000 15:33:22');
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/1.txt', 'This is a file.', 'utf8', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/test/1.txt', 'Different file.', 'utf8', function (err) {
          expect(err).to.not.exist;
          fs.utimes('/1.txt', date, date, function (err) {
            expect(err).to.not.exist;
            fs.utimes('/test/1.txt', date, date, function (err) {
              expect(err).to.not.exist;
              rsync.sourceList(fs, '/1.txt', OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.checksums(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, data) {
                  expect(err).to.not.exist;
                  rsync.diff(fs, '/1.txt', data, OPTION_REC_SIZE, function (err, data) {
                    expect(err).to.not.exist;
                    rsync.patch(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, paths) {
                      expect(err).to.not.exist;
                      expect(paths).to.exist;
                      expect(paths.synced).to.have.length(0);
                      expect(paths.failed).to.have.length(0);
                      fs.readFile('/test/1.txt', 'utf8', function (err, data) {
                        expect(err).to.not.exist;
                        expect(data).to.exist;
                        expect(data).to.equal('Different file.');
                        delete OPTION_REC_SIZE.checksum;
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

  it('should succeed if the source file and destination file have the same mtime and size with \'checksum = true\' flag', function (done) {
    OPTION_SIZE.checksum = true;
    var date = Date.parse('1 Oct 2000 15:33:22');
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/1.txt', 'This is a file.', 'utf8', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/test/1.txt', 'Different file.', 'utf8', function (err) {
          expect(err).to.not.exist;
          fs.utimes('/1.txt', date, date, function (err) {
            expect(err).to.not.exist;
            fs.utimes('/test/1.txt', date, date, function (err) {
              expect(err).to.not.exist;
              rsync.sourceList(fs, '/1.txt', OPTION_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.checksums(fs, '/test/1.txt', data, OPTION_SIZE, function (err, data) {
                  expect(err).to.not.exist;
                  rsync.diff(fs, '/1.txt', data, OPTION_SIZE, function (err, data) {
                    expect(err).to.not.exist;
                    rsync.patch(fs, '/test/1.txt', data, OPTION_SIZE, function (err, paths) {
                      expect(err).to.not.exist;
                      expect(paths).to.exist;
                      expect(paths.synced).to.have.length(1);
                      expect(paths.synced).to.have.members(['/test/1.txt']);
                      expect(paths.failed).to.have.length(0);
                      fs.readFile('/test/1.txt', 'utf8', function (err, data) {
                        expect(err).to.not.exist;
                        expect(data).to.exist;
                        expect(data).to.equal('This is a file.');
                        delete OPTION_SIZE.checksum;
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

  it('should succeed and update mtime with \'time = true\' flag', function (done) {
    var mtime;
    OPTION_REC_SIZE.time = true;

    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/1.txt', 'This is my file.', 'utf8', function (err) {
        expect(err).to.not.exist;
        fs.stat('/1.txt', function (err, stats) {
          expect(err).to.not.exist;
          expect(stats).to.exist;
          mtime = stats.mtime;
          rsync.sourceList(fs, '/1.txt', OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.checksums(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.diff(fs, '/1.txt', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.patch(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, paths) {
                  expect(err).to.not.exist;
                  expect(paths).to.exist;
                  expect(paths.synced).to.have.length(1);
                  expect(paths.synced).to.have.members(['/test/1.txt']);
                  expect(paths.failed).to.have.length(0);
                  fs.readFile('/test/1.txt', 'utf8', function (err, data) {
                    expect(err).to.not.exist;
                    expect(data).to.exist;
                    expect(data).to.equal('This is my file.');
                    fs.stat('/test/1.txt', function (err, stats) {
                      expect(err).to.not.exist;
                      expect(stats).to.exist;
                      expect(stats.mtime).to.equal(mtime);
                      delete OPTION_REC_SIZE.time;
                      done();
                    });
                  });
                });
              });
            });
          });
        })
      });
    });
  });

  it('should copy a symlink as a file with \'links = false\' flag (Default)', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/1.txt', 'This is a file', function (err) {
        expect(err).to.not.exist;
        fs.symlink('/1.txt', '/2', function (err) {
          expect(err).to.not.exist;
          rsync.sourceList(fs, '/2', OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.checksums(fs, '/test/2', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.diff(fs, '/2', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.patch(fs, '/test/2', data, OPTION_REC_SIZE, function (err, paths) {
                  expect(err).to.not.exist;
                  expect(paths).to.exist;
                  expect(paths.synced).to.have.length(1);
                  expect(paths.synced).to.have.members(['/test/2']);
                  expect(paths.failed).to.have.length(0);
                  fs.unlink('/1.txt', function (err) {
                    expect(err).to.not.exist;
                    fs.lstat('/test/2', function (err, stats) {
                      expect(err).to.not.exist;
                      expect(stats).to.exist;
                      expect(stats.type).to.equal('FILE');
                      fs.readFile('/test/2', 'utf8', function (err, data) {
                        expect(err).to.not.exist;
                        expect(data).to.exist;
                        expect(data).to.equal('This is a file');
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

  it('should copy a symlink as a link with \'links = true\' flag', function (done) {
    OPTION_REC_SIZE.links = true;
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/apple.txt', 'This is a file', function (err) {
        expect(err).to.not.exist;
        fs.symlink('/apple.txt', '/apple', function (err) {
          expect(err).to.not.exist;
          rsync.sourceList(fs, '/apple', OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.checksums(fs, '/test/apple', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.diff(fs, '/apple', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.patch(fs, '/test/apple', data, OPTION_REC_SIZE, function (err, paths) {
                  expect(err).to.not.exist;
                  expect(paths).to.exist;
                  expect(paths.synced).to.have.length(1);
                  expect(paths.synced).to.have.members(['/test/apple']);
                  expect(paths.failed).to.have.length(0);
                  fs.lstat('/test/apple', function (err, stats) {
                    expect(err).to.not.exist;
                    expect(stats).to.exist;
                    expect(stats.type).to.equal('SYMLINK');
                    fs.readFile('/test/apple', 'utf8', function (err, data) {
                      expect(err).to.not.exist;
                      expect(data).to.exist;
                      expect(data).to.equal('This is a file');
                      delete OPTION_REC_SIZE.links;
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

  it('should copy a symlink as a file with \'links = false\' flag and update time with \'time: true\' flag', function (done) {
    var mtime;
    OPTION_REC_SIZE.time = true;

    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/1.txt', 'This is a file', function (err) {
        expect(err).to.not.exist;
        fs.symlink('/1.txt', '/2', function (err) {
          expect(err).to.not.exist;
          fs.lstat('/2', function (err, stats) {
            expect(err).to.not.exist;
            expect(stats).to.exist;
            mtime = stats.mtime;
            rsync.sourceList(fs, '/2', OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.checksums(fs, '/test/2', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.diff(fs, '/2', data, OPTION_REC_SIZE, function (err, data) {
                  expect(err).to.not.exist;
                  rsync.patch(fs, '/test/2', data, OPTION_REC_SIZE, function (err, paths) {
                    expect(err).to.not.exist;
                    expect(paths).to.exist;
                    expect(paths.synced).to.have.length(1);
                    expect(paths.synced).to.have.members(['/test/2']);
                    expect(paths.failed).to.have.length(0);
                    fs.unlink('/1.txt', function (err) {
                      expect(err).to.not.exist;
                      fs.lstat('/test/2', function (err, stats) {
                        expect(err).to.not.exist;
                        expect(stats).to.exist;
                        expect(stats.mtime).to.equal(mtime);
                        expect(stats.type).to.equal('FILE');
                        fs.readFile('/test/2', 'utf8', function (err, data) {
                          expect(err).to.not.exist;
                          expect(data).to.exist;
                          expect(data).to.equal('This is a file');
                          delete OPTION_REC_SIZE.time;
                          done();
                        });
                      });
                    });
                  });
                });
              });
            });
          })
        });
      });
    });
  });

  it('should succeed if the destination folder does not exist (Destination directory created)', function (done) {
    fs.writeFile('/1.txt', 'This is my file. It does not exist in the destination folder.', 'utf8', function (err) {
      expect(err).to.not.exist;
      rsync.sourceList(fs, '/1.txt', OPTION_REC_SIZE, function (err, data) {
        expect(err).to.not.exist;
        rsync.checksums(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, data) {
          expect(err).to.not.exist;
          rsync.diff(fs, '/1.txt', data, OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.patch(fs, '/test/1.txt', data, OPTION_REC_SIZE, function (err, paths) {
              expect(err).to.not.exist;
              expect(paths).to.exist;
              expect(paths.synced).to.have.length(1);
              expect(paths.synced).to.have.members(['/test/1.txt']);
              expect(paths.failed).to.have.length(0);
              fs.readFile('/test/1.txt', 'utf8', function (err, data) {
                expect(err).to.not.exist;
                expect(data).to.exist;
                expect(data).to.equal('This is my file. It does not exist in the destination folder.');
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should succeed syncing a directory if the destination directory is empty', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.mkdir('/test2', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/test/1.txt', 'This is my 1st file. It does not have any typos.', 'utf8', function (err) {
          expect(err).to.not.exist;
          fs.writeFile('/test/2.txt', 'This is my 2nd file. It is longer than the destination file.', 'utf8', function (err) {
            expect(err).to.not.exist;
            rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.checksums(fs, '/test2', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                  expect(err).to.not.exist;
                  rsync.patch(fs, '/test2', data, OPTION_REC_SIZE, function (err, paths) {
                    expect(err).to.not.exist;
                    expect(paths).to.exist;
                    expect(paths.synced).to.have.length(2);
                    expect(paths.synced).to.have.members(['/test2/1.txt', '/test2/2.txt']);
                    expect(paths.failed).to.have.length(0);
                    fs.readFile('/test2/1.txt', 'utf8', function (err, data) {
                      expect(err).to.not.exist;
                      expect(data).to.exist;
                      expect(data).to.equal('This is my 1st file. It does not have any typos.');
                      fs.readFile('/test2/2.txt', 'utf8', function (err, data) {
                        expect(err).to.not.exist;
                        expect(data).to.exist;
                        expect(data).to.equal('This is my 2nd file. It is longer than the destination file.');
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

  it('should succeed syncing a directory if the destination directory doesn\'t exist', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.mkdir('/test2', function (err) {
        expect(err).to.not.exist;
        fs.mkdir('/test/folder', function (err) {
          expect(err).to.not.exist;
          fs.writeFile('/test/folder/1.txt', 'This is my 1st file. It does not have any typos.', 'utf8', function (err) {
            expect(err).to.not.exist;
            fs.writeFile('/test/folder/2.txt', 'This is my 2nd file. It is longer than the destination file.', 'utf8', function (err) {
              expect(err).to.not.exist;
              rsync.sourceList(fs, '/test', {
                recursive: true,
                size: 5
              }, function (err, data) {
                expect(err).to.not.exist;
                rsync.checksums(fs, '/test2', data, OPTION_REC_SIZE, function (err, data) {
                  expect(err).to.not.exist;
                  rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                    expect(err).to.not.exist;
                    rsync.patch(fs, '/test2', data, OPTION_REC_SIZE, function (err, paths) {
                      expect(err).to.not.exist;
                      expect(paths).to.exist;
                      expect(paths.synced).to.have.length(3);
                      expect(paths.synced).to.have.members(['/test2/folder', '/test2/folder/1.txt', '/test2/folder/2.txt']);
                      expect(paths.failed).to.have.length(0);
                      fs.stat('/test2/folder', function (err, stats) {
                        expect(err).to.not.exist;
                        expect(stats).to.exist;
                        expect(stats.type).to.equal('DIRECTORY');
                        fs.readFile('/test2/folder/1.txt', 'utf8', function (err, data) {
                          expect(err).to.not.exist;
                          expect(data).to.exist;
                          expect(data).to.equal('This is my 1st file. It does not have any typos.');
                          fs.readFile('/test2/folder/2.txt', 'utf8', function (err, data) {
                            expect(err).to.not.exist;
                            expect(data).to.exist;
                            expect(data).to.equal('This is my 2nd file. It is longer than the destination file.');
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

  it('should succeed syncing a directory recursively, skipping same-size and time files (recursive: true, checksum: false)', function (done) {
    var date = Date.parse('1 Oct 2000 15:33:22');
    OPTION_REC_SIZE.checksum = false;

    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.mkdir('/test/sync', function (err) {
        expect(err).to.not.exist;
        fs.mkdir('/test2', function (err) {
          expect(err).to.not.exist;
          fs.mkdir('/test2/sync', function (err) {
            expect(err).to.not.exist;
            fs.writeFile('/test/1.txt', 'This is my 1st file.', 'utf8', function (err) {
              expect(err).to.not.exist;
              fs.writeFile('/test/sync/2.txt', 'This is my 2nd file.', 'utf8', function (err) {
                expect(err).to.not.exist;
                fs.writeFile('/test/sync/3.txt', 'This is my 3rd file.', 'utf8', function (err) {
                  expect(err).to.not.exist;
                  fs.writeFile('/test2/sync/3.txt', 'This shouldn\'t sync.', 'utf8', function (err) {
                    expect(err).to.not.exist;
                    fs.utimes('/test/sync/3.txt', date, date, function (err) {
                      expect(err).to.not.exist;
                      fs.utimes('/test2/sync/3.txt', date, date, function (err) {
                        expect(err).to.not.exist;
                        rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
                          expect(err).to.not.exist;
                          rsync.checksums(fs, '/test2', data, OPTION_REC_SIZE, function (err, data) {
                            expect(err).to.not.exist;
                            rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                              expect(err).to.not.exist;
                              rsync.patch(fs, '/test2', data, OPTION_REC_SIZE, function (err, paths) {
                                expect(err).to.not.exist;
                                expect(paths).to.exist;
                                expect(paths.synced).to.have.length(3);
                                expect(paths.synced).to.have.members(['/test2/1.txt', '/test2/sync', '/test2/sync/2.txt']);
                                expect(paths.failed).to.have.length(0);
                                fs.readFile('/test2/1.txt', 'utf8', function (err, data) {
                                  expect(err).to.not.exist;
                                  expect(data).to.exist;
                                  expect(data).to.equal('This is my 1st file.');
                                  fs.readFile('/test2/sync/2.txt', 'utf8', function (err, data) {
                                    expect(err).to.not.exist;
                                    expect(data).to.exist;
                                    expect(data).to.equal('This is my 2nd file.');
                                    fs.readFile('/test2/sync/3.txt', 'utf8', function (err, data) {
                                      expect(err).to.not.exist;
                                      expect(data).to.exist;
                                      expect(data).to.equal('This shouldn\'t sync.');
                                      delete OPTION_REC_SIZE.checksum;
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

  it('should sync empty directories', function (done) {
    fs.mkdir('/projects', function (err) {
      expect(err).to.not.exist;
      fs.mkdir('/projects/proj_1', function (err) {
        expect(err).to.not.exist;
        fs.mkdir('/projects/proj_2', function (err) {
          expect(err).to.not.exist;
          fs.writeFile('/projects/proj_1/index.html', 'Hello world', 'utf8', function (err) {
            expect(err).to.not.exist;
            fs.writeFile('/projects/proj_1/styles.css', 'CSS', 'utf8', function (err) {
              expect(err).to.not.exist;
              fs.writeFile('/projects/proj_2/styles2.css', 'CSS', 'utf8', function (err) {
                expect(err).to.not.exist;
                fs.mkdir('/projects/proj_2/inside_proj_2', function (err) {
                  expect(err).to.not.exist;
                  rsync.sourceList(fs, '/projects', OPTION_REC_SIZE, function (err, data) {
                    expect(err).to.not.exist;
                    rsync.checksums(fs2, '/', data, OPTION_REC_SIZE, function (err, data) {
                      expect(err).to.not.exist;
                      rsync.diff(fs, '/projects', data, OPTION_REC_SIZE, function (err, data) {
                        expect(err).to.not.exist;
                        rsync.patch(fs2, '/', data, OPTION_REC_SIZE, function (err, paths) {
                          expect(err).to.not.exist;
                          expect(paths).to.exist;
                          expect(paths.synced).to.have.length(6);
                          expect(paths.synced).to.have.members(['/proj_1', '/proj_2', '/proj_1/index.html', '/proj_1/styles.css', '/proj_2/styles2.css', '/proj_2/inside_proj_2']);
                          expect(paths.failed).to.have.length(0);
                          fs2.readFile('/proj_1/index.html', 'utf8', function (err, data) {
                            expect(err).to.not.exist;
                            expect(data).to.exist;
                            expect(data).to.equal('Hello world');
                            fs2.readFile('/proj_1/styles.css', 'utf8', function (err, data) {
                              expect(err).to.not.exist;
                              expect(data).to.exist;
                              expect(data).to.equal('CSS');
                              fs2.readFile('/proj_2/styles2.css', 'utf8', function (err, data) {
                                expect(err).to.not.exist;
                                expect(data).to.exist;
                                expect(data).to.equal('CSS');
                                fs2.stat('/proj_2/inside_proj_2', function (err, stats) {
                                  expect(err).to.not.exist;
                                  done();
                                })
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

  it('should succeed syncing a directory if the destination directory doesn\'t exist', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.mkdir('/test/dir', function (err) {
        expect(err).to.not.exist;
        fs.mkdir('/test/dir/dirdir', function (err) {
          expect(err).to.not.exist;
          fs.writeFile('/test/dir/dirdir/1.txt', 'This is my 1st file. It does not have any typos.', 'utf8', function (err) {
            expect(err).to.not.exist;
            rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.checksums(fs2, '/', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                  expect(err).to.not.exist;
                  rsync.patch(fs2, '/', data, OPTION_REC_SIZE, function (err, paths) {
                    expect(err).to.not.exist;
                    expect(paths).to.exist;
                    expect(paths.synced).to.have.length(3);
                    expect(paths.synced).to.have.members(['/dir', '/dir/dirdir', '/dir/dirdir/1.txt']);
                    expect(paths.failed).to.have.length(0);
                    fs2.readFile('/dir/dirdir/1.txt', 'utf8', function (err, data) {
                      expect(err).to.not.exist;
                      expect(data).to.exist;
                      expect(data).to.equal('This is my 1st file. It does not have any typos.');
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

  it('should succeed syncing a directory if the destination directories do not exist', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.mkdir('/test/dir1', function (err) {
        expect(err).to.not.exist;
        fs.mkdir('/test/dir2', function (err) {
          expect(err).to.not.exist;
          fs.mkdir('/test/dir1/dir12', function (err) {
            expect(err).to.not.exist;
            fs.mkdir('/test2', function (err) {
              expect(err).to.not.exist;
              rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.checksums(fs, '/test2', data, OPTION_REC_SIZE, function (err, data) {
                  expect(err).to.not.exist;
                  rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                    expect(err).to.not.exist;
                    rsync.patch(fs, '/test2', data, OPTION_REC_SIZE, function (err, paths) {
                      expect(err).to.not.exist;
                      expect(paths).to.exist;
                      expect(paths.synced).to.have.length(3);
                      expect(paths.synced).to.have.members(['/test2/dir1', '/test2/dir2', '/test2/dir1/dir12']);
                      expect(paths.failed).to.have.length(0);
                      fs.stat('/test2', function (err, stats) {
                        expect(err).to.not.exist;
                        expect(stats).to.exist;
                        expect(stats.type).to.equal('DIRECTORY');
                        fs.stat('/test2/dir1', function (err, stats) {
                          expect(err).to.not.exist;
                          expect(stats).to.exist;
                          expect(stats.type).to.equal('DIRECTORY');
                          fs.stat('/test2/dir2', function (err, stats) {
                            expect(err).to.not.exist;
                            expect(stats).to.exist;
                            expect(stats.type).to.equal('DIRECTORY');
                            fs.stat('/test2/dir1/dir12', function (err, stats) {
                              expect(err).to.not.exist;
                              expect(stats).to.exist;
                              expect(stats.type).to.equal('DIRECTORY');
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

  it('should succeed syncing a file that has been renamed', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/test/file1.txt', 'This is the file I created', 'utf8', function (err) {
        expect(err).to.not.exist;
        rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
          expect(err).to.not.exist;
          rsync.checksums(fs2, '/', data, OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.patch(fs2, '/', data, OPTION_REC_SIZE, function (err, paths) {
                expect(err).to.not.exist;
                expect(paths).to.exist;
                expect(paths.synced).to.have.length(1);
                expect(paths.synced).to.have.members(['/file1.txt']);
                expect(paths.failed).to.have.length(0);
                fs2.readFile('/file1.txt', 'utf8', function (err, data) {
                  expect(err).to.not.exist;
                  expect(data).to.exist;
                  expect(data).to.equal('This is the file I created');
                  fs.rename('/test/file1.txt', '/test/myfile.txt', function (err) {
                    expect(err).to.not.exist;
                    fs.readFile('/test/file1.txt', 'utf8', function (err, data) {
                      expect(err).to.exist;
                      expect(err.code).to.equal('ENOENT');
                      rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
                        expect(err).to.not.exist;
                        rsync.checksums(fs2, '/', data, OPTION_REC_SIZE, function (err, data) {
                          expect(err).to.not.exist;
                          rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                            expect(err).to.not.exist;
                            rsync.patch(fs2, '/', data, OPTION_REC_SIZE, function (err, paths) {
                              expect(err).to.not.exist;
                              expect(paths).to.exist;
                              expect(paths.synced).to.have.length(2);
                              expect(paths.synced).to.have.members(['/myfile.txt', '/file1.txt']);
                              expect(paths.failed).to.have.length(0);
                              fs2.readFile('/myfile.txt', 'utf8', function (err, data) {
                                expect(err).to.not.exist;
                                expect(data).to.exist;
                                expect(data).to.equal('This is the file I created');
                                fs2.readFile('/file1.txt', 'utf8', function (err, data) {
                                  expect(err).to.exist;
                                  expect(err.code).to.equal('ENOENT');
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

  it('should succeed syncing a directory that has been renamed', function (done) {
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.mkdir('/test/olddir', function (err) {
        expect(err).to.not.exist;
        fs.mkdir('/test/mydir', function (err) {
          expect(err).to.not.exist;
          fs.writeFile('/test/olddir/file1.txt', 'This is the file I created', 'utf8', function (err) {
            expect(err).to.not.exist;
            rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.checksums(fs2, '/', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                  expect(err).to.not.exist;
                  rsync.patch(fs2, '/', data, OPTION_REC_SIZE, function (err, paths) {
                    expect(err).to.not.exist;
                    expect(paths).to.exist;
                    expect(paths.synced).to.have.length(3);
                    expect(paths.synced).to.have.members(['/olddir', '/mydir', '/olddir/file1.txt']);
                    expect(paths.failed).to.have.length(0);
                    fs2.stat('/olddir', function (err, stats) {
                      expect(err).to.not.exist;
                      expect(stats).to.exist;
                      expect(stats.type).to.equal('DIRECTORY');
                      fs2.readFile('/olddir/file1.txt', 'utf8', function (err, data) {
                        expect(err).to.not.exist;
                        expect(data).to.exist;
                        expect(data).to.equal('This is the file I created');
                        fs2.stat('/mydir', function (err, stats) {
                          expect(err).to.not.exist;
                          expect(stats).to.exist;
                          expect(stats.type).to.equal('DIRECTORY');
                          fs.rename('/test/olddir', '/test/newdir', function (err) {
                            expect(err).to.not.exist;
                            fs.rename('/test/mydir', '/test/notmydir', function (err) {
                              expect(err).to.not.exist;
                              rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
                                expect(err).to.not.exist;
                                rsync.checksums(fs2, '/', data, OPTION_REC_SIZE, function (err, data) {
                                  expect(err).to.not.exist;
                                  rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                                    expect(err).to.not.exist;
                                    rsync.patch(fs2, '/', data, OPTION_REC_SIZE, function (err, paths) {
                                      expect(err).to.not.exist;
                                      expect(paths).to.exist;
                                      expect(paths.synced).to.have.length(5);
                                      expect(paths.synced).to.have.members(['/newdir', '/newdir/file1.txt', '/notmydir', '/olddir', '/mydir']);
                                      expect(paths.failed).to.have.length(0);
                                      fs2.stat('/newdir', function (err, stats) {
                                        expect(err).to.not.exist;
                                        expect(stats).to.exist;
                                        expect(stats.type).to.equal('DIRECTORY');
                                        fs2.readFile('/newdir/file1.txt', 'utf8', function (err, data) {
                                          expect(err).to.not.exist;
                                          expect(data).to.exist;
                                          expect(data).to.equal('This is the file I created');
                                          fs2.stat('/notmydir', function (err, stats) {
                                            expect(err).to.not.exist;
                                            expect(stats).to.exist;
                                            expect(stats.type).to.equal('DIRECTORY');
                                            fs2.stat('/olddir', function (err, stats) {
                                              expect(err).to.exist;
                                              expect(err.code).to.equal('ENOENT');
                                              fs2.stat('/mydir', function (err, stats) {
                                                expect(err).to.exist;
                                                expect(err.code).to.equal('ENOENT');
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
          });
        });
      });
    });
  });

  it('should not sync a file deleted at the source', function (done) {

    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs.writeFile('/test/myfile.txt', 'My file', 'utf8', function (err) {
        expect(err).to.not.exist;
        rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
          expect(err).to.not.exist;
          rsync.checksums(fs2, '/', data, OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.patch(fs2, '/', data, OPTION_REC_SIZE, function (err, paths) {
                expect(err).to.not.exist;
                expect(paths).to.exist;
                expect(paths.synced).to.have.length(1);
                expect(paths.synced).to.have.members(['/myfile.txt']);
                expect(paths.failed).to.have.length(0);
                fs2.readFile('/myfile.txt', 'utf8', function (err, data) {
                  expect(err).to.not.exist;
                  expect(data).to.exist;
                  expect(data).to.equal('My file');
                  fs.unlink('/test/myfile.txt', function (err) {
                    expect(err).to.not.exist;
                    rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
                      expect(err).to.not.exist;
                      rsync.checksums(fs2, '/', data, OPTION_REC_SIZE, function (err, data) {
                        expect(err).to.not.exist;
                        rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                          expect(err).to.not.exist;
                          rsync.patch(fs2, '/', data, OPTION_REC_SIZE, function (err, paths) {
                            expect(err).to.not.exist;
                            expect(paths).to.exist;
                            expect(paths.synced).to.have.length(1);
                            expect(paths.synced).to.have.members(['/myfile.txt']);
                            expect(paths.failed).to.have.length(0);
                            fs2.readFile('/myfile.txt', 'utf8', function (err, data) {
                              expect(err).to.exist;
                              expect(err.code).to.equal('ENOENT');
                              expect(data).to.not.exist;
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

  it('should successfully sync changes in a long file', function (done) {
    var content;
    var strcontent = "<!DOCTYPE html>\n<html>\n<head>\n  <meta charset=\"utf-8\">\n  <title>Sample HTML File</title>\n</head>\n<body>\n  <h1>Webmaker</h1>\n  <img src=\"webmaker-logo.jpg\">\n</body>\n</html>\n I have now changed this file";
    fs.mkdir('/test', function (err) {
      expect(err).to.not.exist;
      fs2.mkdir('/test', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/test/index', strcontent, function (err) {
          expect(err).to.not.exist;
          rsync.sourceList(fs, '/test', OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.checksums(fs2, '/test', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.diff(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.patch(fs2, '/test', data, OPTION_REC_SIZE, function (err, paths) {
                  expect(err).to.not.exist;
                  expect(paths).to.exist;
                  expect(paths.synced).to.have.length(1);
                  expect(paths.synced).to.have.members(['/test/index']);
                  expect(paths.failed).to.have.length(0);
                  fs2.readFile('/test/index', 'utf8', function (err, data) {
                    expect(err).to.not.exist;
                    expect(data).to.exist;
                    expect(data).to.be.equal(strcontent);
                    strcontent += ' I have now changed this file';
                    fs2.writeFile('/test/index', strcontent, function (err) {
                      expect(err).to.not.exist;
                      fs2.readFile('/test/index', 'utf8', function (err, data) {
                        expect(data).to.equal(strcontent);
                        rsync.sourceList(fs2, '/test', OPTION_REC_SIZE, function (err, data) {
                          expect(err).to.not.exist;
                          rsync.checksums(fs, '/test', data, OPTION_REC_SIZE, function (err, data) {
                            expect(err).to.not.exist;
                            rsync.diff(fs2, '/test', data, OPTION_REC_SIZE, function (err, data) {
                              expect(err).to.not.exist;
                              rsync.patch(fs, '/test', data, OPTION_REC_SIZE, function (err, paths) {
                                expect(err).to.not.exist;
                                expect(paths).to.exist;
                                expect(paths.synced).to.have.length(1);
                                expect(paths.synced).to.have.members(['/test/index']);
                                expect(paths.failed).to.have.length(0);
                                fs.readFile('/test/index', 'utf8', function (err, data) {
                                  expect(err).to.not.exist;
                                  expect(data).to.exist;
                                  expect(data).to.equal(strcontent);
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

  it('should succeed with files with special utf-8 characters', function (done) {
    OPTION_REC_SIZE.time = true;
    fs.mkdir('/projects', function (err) {
      expect(err).to.not.exist;
      fs2.mkdir('/projects', function (err) {
        expect(err).to.not.exist;
        fs.writeFile('/projects/hello', 'function hello() { console.log("hello"); } hello();', function (err) {
          expect(err).to.not.exist;
          rsync.sourceList(fs, '/projects/hello', OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.checksums(fs2, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.diff(fs, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.patch(fs2, '/projects/hello', data, OPTION_REC_SIZE, function (err, paths) {
                  expect(err).to.not.exist;
                  expect(paths).to.exist;
                  expect(paths.synced).to.have.length(1);
                  expect(paths.synced).to.have.members(['/projects/hello']);
                  expect(paths.failed).to.have.length(0);
                  fs2.readFile('/projects/hello', 'utf8', function (err, data) {
                    expect(err).to.not.exist;
                    expect(data).to.exist;
                    expect(data).to.equal('function hello() { console.log("hello"); } hello();');
                    fs2.writeFile('/projects/hello', 'function hello() { console.log("hello"); } function world() { console.log("world"); } hello(); world();', function (err) {
                      expect(err).to.not.exist;
                      rsync.sourceList(fs2, '/projects/hello', OPTION_REC_SIZE, function (err, data) {
                        expect(err).to.not.exist;
                        rsync.checksums(fs, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
                          expect(err).to.not.exist;
                          rsync.diff(fs2, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
                            expect(err).to.not.exist;
                            rsync.patch(fs, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
                              expect(err).to.not.exist;
                              expect(paths).to.exist;
                              expect(paths.synced).to.have.length(1);
                              expect(paths.synced).to.have.members(['/projects/hello']);
                              expect(paths.failed).to.have.length(0);
                              fs.readFile('/projects/hello', 'utf8', function (err, data) {
                                expect(err).to.not.exist;
                                expect(data).to.exist;
                                expect(data).to.equal('function hello() { console.log("hello"); } function world() { console.log("world"); } hello(); world();');
                                fs2.readFile('/projects/hello', 'utf8', function (err, data) {
                                  expect(err).to.not.exist;
                                  expect(data).to.exist;
                                  expect(data).to.equal('function hello() { console.log("hello"); } function world() { console.log("world"); } hello(); world();');
                                  delete OPTION_REC_SIZE.time;
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

  it('should succeed with Buffer data', function (done) {
    OPTION_REC_SIZE.time = true;
    fs.mkdir('/projects', function (err) {
      expect(err).to.not.exist;
      fs2.mkdir('/projects', function (err) {
        expect(err).to.not.exist;
        var arrayData = new Buffer([102, 117, 110, 99, 116, 32, 104, 101, 108, 108, 111, 40, 41, 32, 123, 32, 119, 105, 110, 100, 111, 119, 46, 114, 117, 110, 110, 101, 114, 87, 105, 110, 100, 111, 119, 46, 112, 114, 111, 120, 121, 67, 111, 110, 115, 111, 108, 101, 46, 108, 111, 103, 40, 34, 104, 101, 108, 108, 111, 34, 41, 59, 32, 125, 32, 104, 101, 108, 108, 111, 40, 41, 59]);
        fs.writeFile('/projects/hello', arrayData, function (err) {
          expect(err).to.not.exist;
          rsync.sourceList(fs, '/projects/hello', OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.checksums(fs2, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.diff(fs, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.patch(fs2, '/projects/hello', data, OPTION_REC_SIZE, function (err, paths) {
                  expect(err).to.not.exist;
                  expect(paths).to.exist;
                  expect(paths.synced).to.have.length(1);
                  expect(paths.synced).to.have.members(['/projects/hello']);
                  expect(paths.failed).to.have.length(0);
                  fs2.readFile('/projects/hello', function (err, data) {
                    expect(err).to.not.exist;
                    expect(data).to.exist;
                    expect(data).to.deep.equal(arrayData);
                    var arrayData2 = new Buffer([40, 41, 32, 123, 32, 119, 105, 110, 100, 111, 119, 46, 114, 117, 110, 110, 101, 114, 87, 105, 110, 100, 111, 119, 46, 112, 114, 111, 120, 121, 67, 111, 110, 115, 111, 108, 101, 46, 108, 111, 103, 40, 34, 104, 101, 108, 108, 111, 34, 41, 59, 32, 125, 32, 102, 117, 110, 99, 105, 111, 110, 32, 119, 111, 114, 108, 100, 40]);
                    fs2.writeFile('/projects/hello', arrayData2, function (err) {
                      expect(err).to.not.exist;
                      rsync.sourceList(fs2, '/projects/hello', OPTION_REC_SIZE, function (err, data) {
                        expect(err).to.not.exist;
                        rsync.checksums(fs, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
                          expect(err).to.not.exist;
                          rsync.diff(fs2, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
                            expect(err).to.not.exist;
                            rsync.patch(fs, '/projects/hello', data, OPTION_REC_SIZE, function (err, paths) {
                              expect(err).to.not.exist;
                              expect(paths).to.exist;
                              expect(paths.synced).to.have.length(1);
                              expect(paths.synced).to.have.members(['/projects/hello']);
                              expect(paths.failed).to.have.length(0);
                              fs.readFile('/projects/hello', function (err, data) {
                                expect(err).to.not.exist;
                                expect(data).to.exist;
                                expect(data).to.deep.equal(arrayData2);
                                fs2.readFile('/projects/hello', function (err, data) {
                                  expect(err).to.not.exist;
                                  expect(data).to.exist;
                                  expect(data).to.deep.equal(arrayData2);
                                  delete OPTION_REC_SIZE.time;
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

  it('should succeed with very large binary file', function (done) {
    OPTION_REC_SIZE.time = true;
    fs.mkdir('/projects', function (err) {
      expect(err).to.not.exist;
      fs2.mkdir('/projects', function (err) {
        expect(err).to.not.exist;
        var arrayData = new Buffer([97, 115, 100, 106, 97, 115, 106, 105, 100, 106, 105, 97, 115, 105, 106, 111, 100, 115, 97, 105, 111, 100, 105, 111, 106, 97, 115, 100, 105, 104, 97, 115, 104, 117, 100, 104, 117, 97, 115, 104, 100, 105, 111, 97, 115, 104, 105, 111, 100, 105, 104, 111, 97, 115, 104, 105, 100, 111, 97, 104, 105, 115, 111, 100, 105, 104, 111, 97, 115, 104, 105, 111, 100, 104, 97, 111, 115, 105, 100, 104, 111, 105, 97, 115, 104, 105, 111, 100, 104, 111, 105, 97, 115, 100, 111, 104, 105, 115, 97, 104, 50, 112, 100, 52, 105, 48, 112, 49, 50, 56, 52, 57, 111, 100, 121, 49, 117, 50, 107, 52, 104, 50, 108, 49, 105, 117, 52, 100, 49, 50, 55, 56, 52, 121, 49, 102, 105, 50, 121, 99, 52, 108, 49, 50, 106, 100, 111, 52, 117, 49, 106, 50, 111, 108, 107, 104, 52, 49, 108, 107, 100, 120, 117, 52, 105, 111, 49, 50, 117, 104, 108, 99, 52, 104, 100, 111, 50, 49, 59, 105, 100, 52, 111, 108, 50, 49, 104, 106, 52, 108, 99]);
        fs.writeFile('/projects/hello', arrayData, function (err) {
          expect(err).to.not.exist;
          rsync.sourceList(fs, '/projects/hello', OPTION_REC_SIZE, function (err, data) {
            expect(err).to.not.exist;
            rsync.checksums(fs2, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
              expect(err).to.not.exist;
              rsync.diff(fs, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
                expect(err).to.not.exist;
                rsync.patch(fs2, '/projects/hello', data, OPTION_REC_SIZE, function (err, paths) {
                  expect(err).to.not.exist;
                  expect(paths).to.exist;
                  expect(paths.synced).to.have.length(1);
                  expect(paths.synced).to.have.members(['/projects/hello']);
                  expect(paths.failed).to.have.length(0);
                  fs2.readFile('/projects/hello', function (err, data) {
                    expect(err).to.not.exist;
                    expect(data).to.exist;
                    expect(data).to.deep.equal(arrayData);
                    var arrayData2 = new Buffer([97, 115, 100, 106, 97, 115, 106, 105, 100, 106, 105, 97, 115, 105, 106, 111, 100, 115, 97, 105, 111, 100, 105, 111, 106, 97, 115, 100, 105, 104, 97, 115, 104, 117, 100, 104, 117, 97, 115, 104, 100, 105, 111, 97, 115, 104, 105, 111, 100, 105, 104, 111, 97, 115, 104, 105, 100, 111, 97, 104, 105, 115, 111, 100, 105, 104, 111, 97, 115, 104, 105, 111, 100, 104, 97, 111, 115, 105, 100, 104, 111, 105, 97, 115, 104, 105, 111, 100, 104, 111, 105, 97, 115, 100, 111, 104, 105, 115, 97, 104, 50, 106, 52, 100, 104, 49, 50, 52, 105, 115, 106, 49, 111, 112, 50, 106, 52, 100, 111, 112, 49, 105, 50, 106, 52, 111, 112, 100, 49, 50, 106, 111, 52, 112, 49, 50, 106, 52, 111, 112, 49, 50, 57, 52, 117, 49, 50, 106, 108, 52, 107, 49, 109, 50, 108, 107, 100, 52, 109, 49, 110, 118, 50, 52, 105, 49, 50, 105, 111, 118, 52, 104, 49, 50, 52, 104, 118]);
                    fs2.writeFile('/projects/hello', arrayData2, function (err) {
                      expect(err).to.not.exist;
                      rsync.sourceList(fs2, '/projects/hello', OPTION_REC_SIZE, function (err, data) {
                        expect(err).to.not.exist;
                        rsync.checksums(fs, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
                          expect(err).to.not.exist;
                          rsync.diff(fs2, '/projects/hello', data, OPTION_REC_SIZE, function (err, data) {
                            expect(err).to.not.exist;
                            rsync.patch(fs, '/projects/hello', data, OPTION_REC_SIZE, function (err, paths) {
                              expect(err).to.not.exist;
                              expect(paths).to.exist;
                              expect(paths.synced).to.have.length(1);
                              expect(paths.synced).to.have.members(['/projects/hello']);
                              expect(paths.failed).to.have.length(0);
                              fs.readFile('/projects/hello', function (err, data) {
                                expect(err).to.not.exist;
                                expect(data).to.exist;
                                expect(data).to.deep.equal(arrayData2);
                                fs2.readFile('/projects/hello', function (err, data) {
                                  expect(err).to.not.exist;
                                  expect(data).to.exist;
                                  expect(data).to.deep.equal(arrayData2);
                                  delete OPTION_REC_SIZE.time;
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
