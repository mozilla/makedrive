var OPTION_SIZE = { size: 5 };
var OPTION_REC_SIZE = { recursive: true, size: 5 };

var Filer = require('../../lib/filer.js'),
    Buffer = Filer.Buffer,
    rsync = require('../../lib/rsync'),
    expect = require('chai').expect,
    testUtils = require('../lib/util'),
    fs,
    fs2,
    provider;

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

// Assert that every step of rsync completes successfully
// i.e. without an error and that the patch step correctly
// patches the paths as described by patchedPaths
function rsyncAssertions(path, options, patchedPaths, callback) {
  var synced = patchedPaths.synced || [];
  var failed = patchedPaths.failed || [];

  rsync.sourceList(fs, path, options, function (err, srcList) {
    expect(err, 'Failed at Source List').not.to.exist;
    rsync.checksums(fs2, path, srcList, options, function (err, checksums) {
      expect(err, 'Failed at Checksums').not.to.exist;
      rsync.diff(fs, path, checksums, options, function (err, diffs) {
        expect(err, 'Failed at Diffs').not.to.exist;
        rsync.patch(fs2, path, diffs, options, function (err, paths) {
          expect(err, 'Failed at Patch').not.to.exist;
          expect(paths).to.exist;
          expect(paths.synced).to.have.length(synced.length);
          expect(paths.synced).to.have.members(synced);
          expect(paths.failed).to.have.length(failed.length);
          if(failed.length) {
            expect(paths.failed).to.have.members(failed);
          }
          callback();
        });
      });
    });
  });
}

// Assert that rsync steps complete successfully when the
// sync occurs in the reverse direction i.e. dest -> src
function reverseRsyncAssertions(path, options, patchedPaths, callback) {
  var fsTemp = fs;
  fs = fs2;
  fs2 = fsTemp;

  rsyncAssertions(path, options, patchedPaths, function () {
    fs2 = fs;
    fs = fsTemp;
    callback();
  });
}

function getRandomArray(size) {
  var arr = [];

  for(var i = 0; i < size; i++) {
    arr.push(Math.floor(Math.random() * 999));
  }

  return arr;
}

describe('[Rsync Functional tests]', function() {
  beforeEach(fsInit);
  afterEach(fsCleanup);

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
      expect(paths).not.to.exist;
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
      expect(paths).not.to.exist;
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
    var patchedPaths = {synced: ['/1.txt']};

    fs.writeFile('/1.txt', 'This is my file. It does not have any typos.', function (err) {
      if(err) throw err;
      fs2.writeFile('/1.txt', 'This iz mi fiel. It doez not have any topos,', function (err) {
        if(err) throw err;
        rsyncAssertions('/1.txt', OPTION_SIZE, patchedPaths, function () {
          fs2.readFile('/1.txt', 'utf8', function (err, data) {
            expect(err).not.to.exist;
            expect(data).to.equal('This is my file. It does not have any typos.');
            done();
          });
        });
      });
    });
  });

  it('should succeed if the source file is longer than the destination file. (Destination appended)', function (done) {
    var patchedPaths = {synced: ['/1.txt']};

    fs.writeFile('/1.txt', 'This is my file. It is longer than the destination file.', function (err) {
      if(err) throw err;
      fs2.writeFile('/1.txt', 'This is my file.', function (err) {
        if(err) throw err;
        rsyncAssertions('/1.txt', OPTION_REC_SIZE, patchedPaths, function () {
          fs2.readFile('/1.txt', 'utf8', function (err, data) {
            expect(err).not.to.exist;
            expect(data).to.equal('This is my file. It is longer than the destination file.');
            done();
          });
        });
      });
    });
  });

  it('should succeed if the source file shorter than the destination file. (Destination truncated)', function (done) {
    var patchedPaths = {synced: ['/1.txt']};

    fs.writeFile('/1.txt', 'This is my file.', function (err) {
      if(err) throw err;
      fs2.writeFile('/1.txt', 'This is my file. It is longer than the source version.', function (err) {
        if(err) throw err;
        rsyncAssertions('/1.txt', OPTION_REC_SIZE, patchedPaths, function () {
          fs2.readFile('/1.txt', 'utf8', function (err, data) {
            expect(err).not.to.exist;
            expect(data).to.equal('This is my file.');
            done();
          });
        });
      });
    });
  });

  it('should succeed if the source file does not exist in the destination folder (Destination file created)', function (done) {
    var patchedPaths = {synced: ['/1.txt']};

    fs.writeFile('/1.txt', 'This is my file. It does not exist in the destination folder.', function (err) {
      if(err) throw err;
      rsyncAssertions('/1.txt', OPTION_REC_SIZE, patchedPaths, function () {
        fs2.readFile('/1.txt', 'utf8', function (err, data) {
          expect(err).not.to.exist;
          expect(data).to.equal('This is my file. It does not exist in the destination folder.');
          done();
        });
      });
    });
  });

  it('should succeed if no options are provided', function (done) {
    var patchedPaths = {synced: ['/1.txt']};

    fs.writeFile('/1.txt', 'This is my file. It does not exist in the destination folder.', function (err) {
      if(err) throw err;
      rsyncAssertions('/1.txt', null, patchedPaths, function () {
        fs2.readFile('/1.txt', 'utf8', function (err, data) {
          expect(err).not.to.exist;
          expect(data).to.equal('This is my file. It does not exist in the destination folder.');
          done();
        });
      });
    });
  });

  it('should do nothing if the source file and destination file have the same mtime and size with \'checksum = false\' flag (Default)', function (done) {
    OPTION_REC_SIZE.checksum = false;
    var date = Date.parse('1 Oct 2000 15:33:22');
    var patchedPaths = {synced: ['/1.txt']};

    fs.writeFile('/1.txt', 'This is a file.', function (err) {
      if(err) throw err;
      fs2.writeFile('/1.txt', 'Different file.', function (err) {
        if(err) throw err;
        fs.utimes('/1.txt', date, date, function (err) {
          if(err) throw err;
          fs2.utimes('/1.txt', date, date, function (err) {
            if(err) throw err;
            rsyncAssertions('/1.txt', OPTION_REC_SIZE, patchedPaths, function () {
              fs2.readFile('/1.txt', 'utf8', function (err, data) {
                expect(err).not.to.exist;
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

  it('should succeed if the source file and destination file have the same mtime and size with \'checksum = true\' flag', function (done) {
    OPTION_SIZE.checksum = true;
    var date = Date.parse('1 Oct 2000 15:33:22');
    var patchedPaths = {synced: ['/1.txt']};

    fs.writeFile('/1.txt', 'This is a file.', function (err) {
      if(err) throw err;
      fs2.writeFile('/1.txt', 'Different file.', function (err) {
        if(err) throw err;
        fs.utimes('/1.txt', date, date, function (err) {
          if(err) throw err;
          fs2.utimes('/1.txt', date, date, function (err) {
            if(err) throw err;
            rsyncAssertions('/1.txt', OPTION_SIZE, patchedPaths, function () {
              fs2.readFile('/1.txt', 'utf8', function (err, data) {
                expect(err).not.to.exist;
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

  it('should succeed and update mtime with \'time = true\' flag', function (done) {
    var mtime;
    OPTION_REC_SIZE.time = true;
    var patchedPaths = {synced: ['/1.txt']};

    fs.writeFile('/1.txt', 'This is my file.', function (err) {
      if(err) throw err;
      fs.stat('/1.txt', function (err, stats) {
        if(err) throw err;
        expect(stats).to.exist;
        mtime = stats.mtime;
        rsyncAssertions('/1.txt', OPTION_REC_SIZE, patchedPaths, function () {
          fs2.readFile('/1.txt', 'utf8', function (err, data) {
            expect(err).not.to.exist;
            expect(data).to.equal('This is my file.');
            fs2.stat('/1.txt', function (err, stats) {
              expect(err).not.to.exist;
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

  it('should copy a symlink as a file with \'links = false\' flag (Default)', function (done) {
    var patchedPaths = {synced: ['/2']};

    fs.writeFile('/1.txt', 'This is a file', function (err) {
      if(err) throw err;
      fs.symlink('/1.txt', '/2', function (err) {
        if(err) throw err;
        rsyncAssertions('/2', OPTION_REC_SIZE, patchedPaths, function () {
          fs2.lstat('/2', function (err, stats) {
            expect(err).not.to.exist;
            expect(stats).to.exist;
            expect(stats.type).to.equal('FILE');
            fs2.readFile('/2', 'utf8', function (err, data) {
              expect(err).not.to.exist;
              expect(data).to.equal('This is a file');
              done();
            });
          });
        });
      });
    });
  });

  it('should copy a symlink as a link with \'links = true\' flag', function (done) {
    OPTION_REC_SIZE.links = true;
    var patchedPaths = {synced: ['/apple']};

    fs.writeFile('/apple.txt', 'This is a file', function (err) {
      if(err) throw err;
      fs2.writeFile('/apple.txt', 'This is a file', function (err) {
        if(err) throw err;
        fs.symlink('/apple.txt', '/apple', function (err) {
          if(err) throw err;
          rsyncAssertions('/apple', OPTION_REC_SIZE, patchedPaths, function () {
            fs2.lstat('/apple', function (err, stats) {
              expect(err).not.to.exist;
              expect(stats).to.exist;
              expect(stats.type).to.equal('SYMLINK');
              fs2.readFile('/apple', 'utf8', function (err, data) {
                expect(err).not.to.exist;
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

  it('should copy a symlink as a file with \'links = false\' flag and update time with \'time = true\' flag', function (done) {
    var mtime;
    OPTION_REC_SIZE.time = true;
    var patchedPaths = {synced: ['/2']};

    fs.writeFile('/1.txt', 'This is a file', function (err) {
      if(err) throw err;
      fs2.writeFile('/1.txt', 'This is a file', function (err) {
        if(err) throw err;
        fs.symlink('/1.txt', '/2', function (err) {
          if(err) throw err;
          fs.lstat('/2', function (err, stats) {
            if(err) throw err;
            mtime = stats.mtime;
            rsyncAssertions('/2', OPTION_REC_SIZE, patchedPaths, function () {
              fs2.unlink('/1.txt', function (err) {
                expect(err).not.to.exist;
                fs2.lstat('/2', function (err, stats) {
                  expect(err).not.to.exist;
                  expect(stats).to.exist;
                  expect(stats.mtime).to.equal(mtime);
                  expect(stats.type).to.equal('FILE');
                  fs2.readFile('/2', 'utf8', function (err, data) {
                    expect(err).not.to.exist;
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
    });
  });

  it('should succeed if the destination parent folder does not exist (Destination directory created)', function (done) {
    var patchedPaths = {synced: ['/test/1.txt']};

    fs.mkdir('/test', function (err) {
      if(err) throw err;
      fs.writeFile('/test/1.txt', 'This is my file. It does not exist in the destination folder.', function (err) {
        if(err) throw err;
        rsyncAssertions('/test/1.txt', OPTION_REC_SIZE, patchedPaths, function () {
          fs2.readFile('/test/1.txt', 'utf8', function (err, data) {
            expect(err).not.to.exist;
            expect(data).to.equal('This is my file. It does not exist in the destination folder.');
            done();
          });
        });
      });
    });
  });

  it('should succeed syncing a directory if the destination directory is empty', function (done) {
    var layout = {'/test/1.txt': 'This is my 1st file. It does not have any typos.',
                  '/test/2.txt': 'This is my 2nd file. It is longer than the destination file.'};
    var patchedPaths = {synced: ['/test', '/test/1.txt', '/test/2.txt']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      fs2.mkdir('/test', function (err) {
        if(err) throw err;
        rsyncAssertions('/test', OPTION_REC_SIZE, patchedPaths, function () {
          testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
            expect(err).not.to.exist;
            done();
          });
        });
      });
    });
  });

  it('should succeed syncing a directory if the destination directory doesn\'t exist', function (done) {
    var layout = {'/test/folder/1.txt': 'This is my 1st file. It does not have any typos.',
              '/test/folder/2.txt': 'This is my 2nd file. It is longer than the destination file.'};
    var patchedPaths = {synced: ['/test', '/test/folder', '/test/folder/1.txt', '/test/folder/2.txt']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      rsyncAssertions('/test', OPTION_REC_SIZE, patchedPaths, function () {
        testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
          expect(err).not.to.exist;
          done();
        });
      });
    });
  });

  it('should succeed syncing a directory recursively, skipping same-size and time files (recursive: true, checksum: false)', function (done) {
    var date = Date.parse('1 Oct 2000 15:33:22');
    OPTION_REC_SIZE.checksum = false;
    var layout = {'/test/sync/1.txt': 'This is my 1st file.',
              '/test/sync/2.txt': 'This is my 2nd file.',
              '/test/sync/3.txt': 'This is my 3rd file.'};
    var patchedPaths = {synced: ['/test', '/test/sync/1.txt', '/test/sync', '/test/sync/2.txt', '/test/sync/3.txt']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      (new fs2.Shell()).mkdirp('/test/sync', function (err) {
        if(err) throw err;
        fs2.writeFile('/test/sync/3.txt', 'This shouldn\'t sync.', function (err) {
          if(err) throw err;
          fs.utimes('/test/sync/3.txt', date, date, function (err) {
            if(err) throw err;
            fs2.utimes('/test/sync/3.txt', date, date, function (err) {
              if(err) throw err;
              rsyncAssertions('/test', OPTION_REC_SIZE, patchedPaths, function () {
                // fs2 should not sync 3.txt as it has the same modified date and time
                // therefore, the layout will change slightly
                layout['/test/sync/3.txt'] = 'This shouldn\'t sync.';
                testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
                  expect(err).not.to.exist;
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

  it('should sync empty directories', function (done) {
    var layout = {'/projects/proj_1/index.html': 'Hello world',
                  '/projects/proj_1/styles.css': 'CSS',
                  '/projects/proj_2/styles2.css': 'CSS',
                  '/projects/proj_2/inside_proj_2': null};
    var patchedPaths = {synced: ['/', '/projects', '/projects/proj_1', '/projects/proj_2', '/projects/proj_1/index.html', '/projects/proj_1/styles.css', '/projects/proj_2/styles2.css', '/projects/proj_2/inside_proj_2']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      rsyncAssertions('/', OPTION_REC_SIZE, patchedPaths, function () {
        testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
          expect(err).not.to.exist;
          done();
        });
      });
    });
  });

  it('should succeed syncing a directory if the destination directory doesn\'t exist', function (done) {
    var layout = {'/test/dir/dirdir/1.txt': 'This is my 1st file. It does not have any typos.'};
    var patchedPaths = {synced: ['/', '/test', '/test/dir', '/test/dir/dirdir', '/test/dir/dirdir/1.txt']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      rsyncAssertions('/', OPTION_REC_SIZE, patchedPaths, function () {
        testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
          expect(err).not.to.exist;
          done();
        });
      });
    });
  });

  it('should succeed syncing a directory if the destination directories do not exist', function (done) {
    var layout = {'/test/dir1/dir12': null,
                  '/test/dir2': null};
    var patchedPaths = {synced: ['/test', '/test/dir1', '/test/dir2', '/test/dir1/dir12']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      fs2.mkdir('/test', function (err) {
        if(err) throw err;
        rsyncAssertions('/test', OPTION_REC_SIZE, patchedPaths, function () {
          testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
            expect(err).not.to.exist;
            done();
          });
        });
      });
    });
  });

  it('should succeed syncing a file that has been renamed', function (done) {
    var layout = {'/file1.txt': 'This is the file I created'};
    var patchedPaths = {synced: ['/', '/file1.txt']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      rsyncAssertions('/', OPTION_REC_SIZE, patchedPaths, function () {
        testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
          expect(err).not.to.exist;
          fs.rename('/file1.txt', '/myfile.txt', function (err) {
            if(err) throw err;
            layout = {'/myfile.txt': 'This is the file I created'};
            patchedPaths.synced.push('/myfile.txt');
            rsyncAssertions('/', OPTION_REC_SIZE, patchedPaths, function () {
              testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
                expect(err).not.to.exist;
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should succeed syncing a directory that has been renamed', function (done) {
    var layout = {'/olddir/file1.txt': 'This is the file I created',
                  '/mydir': null};
    var layout2 = {'/newdir/file1.txt': 'This is the file I created',
                  '/notmydir': null};
    var patchedPaths = {synced: ['/', '/olddir', '/mydir', '/olddir/file1.txt']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      rsyncAssertions('/', OPTION_REC_SIZE, patchedPaths, function () {
        testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
          expect(err).not.to.exist;
          fs.rename('/olddir', '/newdir', function (err) {
            if(err) throw err;
            fs.rename('/mydir', '/notmydir', function (err) {
              if(err) throw err;
              patchedPaths.synced.push('/newdir', '/newdir/file1.txt', '/notmydir');
              rsyncAssertions('/', OPTION_REC_SIZE, patchedPaths, function () {
                testUtils.ensureFilesystemLayout(fs2, layout2, function (err) {
                  expect(err).not.to.exist;
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  it('should not sync a file deleted at the source', function (done) {
    var layout = {'/myfile.txt': 'My file'};
    var patchedPaths = {synced: ['/', '/myfile.txt']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      rsyncAssertions('/', OPTION_REC_SIZE, patchedPaths, function () {
        testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
          expect(err).not.to.exist;
          fs.unlink('/myfile.txt', function (err) {
            if(err) throw err;
            rsyncAssertions('/', OPTION_REC_SIZE, patchedPaths, function () {
              layout = {};
              testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
                expect(err).not.to.exist;
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should successfully sync changes in a long file', function (done) {
    var layout = {'/test/index': '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>Sample HTML File</title>\n</head>\n<body>\n  <h1>Webmaker</h1>\n  <img src="webmaker-logo.jpg">\n</body>\n</html>\n I have now changed this file'};
    var patchedPaths = {synced: ['/test', '/test/index']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      fs2.mkdir('/test', function (err) {
        if(err) throw err;
        rsyncAssertions('/test', OPTION_REC_SIZE, patchedPaths, function () {
          testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
            expect(err).not.to.exist;
            layout['/test/index'] += ' I have now changed this file';
            testUtils.createFilesystemLayout(fs, layout, function (err) {
              if(err) throw err;
              rsyncAssertions('/test', OPTION_REC_SIZE, patchedPaths, function () {
                testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
                  expect(err).not.to.exist;
                  done();
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
    var layout = {'/projects/hello': 'function hello() { console.log("hello"); } hello();'};
    var patchedPaths = {synced: ['/projects/hello']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      fs2.mkdir('/projects', function (err) {
        if(err) throw err;
        rsyncAssertions('/projects/hello', OPTION_REC_SIZE, patchedPaths, function () {
          testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
            expect(err).not.to.exist;
            layout['/projects/hello'] = 'function hello() { console.log("hello"); } function world() { console.log("world"); } hello(); world();';
            testUtils.createFilesystemLayout(fs2, layout, function (err) {
              if(err) throw err;
              reverseRsyncAssertions('/projects/hello', OPTION_REC_SIZE, patchedPaths, function () {
                testUtils.ensureFilesystemLayout(fs, layout, function (err) {
                  expect(err).not.to.exist;
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

  it('should succeed with Buffer data', function (done) {
    OPTION_REC_SIZE.time = true;
    // We hard-code the buffers because using new Buffer(n)
    // is troublesome. The buffer tends to change in the middle
    // of the test.
    var layout = {'/projects/hello': new Buffer(getRandomArray(80))};
    var patchedPaths = {synced: ['/projects/hello']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      fs2.mkdir('/projects', function (err) {
        if(err) throw err;
        rsyncAssertions('/projects/hello', OPTION_REC_SIZE, patchedPaths, function () {
          testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
            expect(err).not.to.exist;
            layout['/projects/hello'] = new Buffer(getRandomArray(60));
            testUtils.createFilesystemLayout(fs2, layout, function (err) {
              if(err) throw err;
              reverseRsyncAssertions('/projects/hello', OPTION_REC_SIZE, patchedPaths, function () {
                testUtils.ensureFilesystemLayout(fs, layout, function (err) {
                  expect(err).not.to.exist;
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

  it('should succeed with large binary file', function (done) {
    OPTION_REC_SIZE.time = true;
    var layout = {'/projects/hello': new Buffer(getRandomArray(1000))};
    var patchedPaths = {synced: ['/projects/hello']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      fs2.mkdir('/projects', function (err) {
        if(err) throw err;
        rsyncAssertions('/projects/hello', OPTION_REC_SIZE, patchedPaths, function () {
          testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
            expect(err).not.to.exist;
            layout['/projects/hello'] = new Buffer(getRandomArray(2000));
            testUtils.createFilesystemLayout(fs2, layout, function (err) {
              if(err) throw err;
              reverseRsyncAssertions('/projects/hello', OPTION_REC_SIZE, patchedPaths, function () {
                testUtils.ensureFilesystemLayout(fs, layout, function (err) {
                  expect(err).not.to.exist;
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

  it('should create a non-existent directory if the directory path is used to sync', function (done) {
    var layout = {'/dir/dir2': null};
    var patchedPaths = {synced: ['/dir', '/dir/dir2']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      rsyncAssertions('/dir', OPTION_REC_SIZE, patchedPaths, function () {
        testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
          expect(err).not.to.exist;
          done();
        });
      });
    });
  });

  it('should create a non-existent directory if it is empty and the path is used to sync', function (done) {
    var layout = {'/dir': null};
    var patchedPaths = {synced: ['/dir']};

    testUtils.createFilesystemLayout(fs, layout, function (err) {
      if(err) throw err;
      rsyncAssertions('/dir', OPTION_REC_SIZE, patchedPaths, function () {
        testUtils.ensureFilesystemLayout(fs2, layout, function (err) {
          expect(err).not.to.exist;
          done();
        });
      });
    });
  });
});
