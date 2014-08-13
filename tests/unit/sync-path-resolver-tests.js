/*jshint expr: true*/

var expect = require('chai').expect;
var pathResolver = require('../../lib/sync-path-resolver.js');
var resolvePath = pathResolver.resolve;

describe('Resolution path tests', function () {
  it('should have resolve as a function', function (done) {
    expect(pathResolver.resolve).to.be.a.function;
    done();
  });

  it('should return / as the common path', function (done) {
    expect(pathResolver.resolve(null, null)).to.equal('/');
    done();
  });

  it('should return /dir as the common path', function (done) {
    expect(pathResolver.resolve('/dir')).to.equal('/dir');
    done();
  });

  it('should return /dir as the common path', function (done) {
    expect(pathResolver.resolve(null, '/dir')).to.equal('/dir');
    done();
  });

  it('should return /dir as the common path', function (done) {
    expect(pathResolver.resolve('/dir/myfile.txt', '/dir/myfile2.txt')).to.equal('/dir');
    done();
  });

  it('should return /dir as the common path', function (done) {
    expect(pathResolver.resolve('/dir/myfile.txt', '/dir')).to.equal('/dir');
    done();
  });

  it('should return / as the common path', function (done) {
    expect(pathResolver.resolve('/dir/myfile.txt', '/dir2/myfile.txt')).to.equal('/');
    done();
  });

  it('should return / as the common path', function (done) {
    expect(pathResolver.resolve('/', '/dir/subdir/subsubdir')).to.equal('/');
    done();
  });
});
