var expect = require('chai').expect;
var pathResolver = require('../../lib/sync-path-resolver.js');

describe('Resolution path tests', function () {
  it('should have resolve as a function', function () {
    expect(pathResolver.resolve).to.be.a('function');
  });

  it('should have resolveFromArray as a function', function() {
    expect(pathResolver.resolveFromArray).to.be.a('function');
  });

  it('should return / as the common path', function () {
    expect(pathResolver.resolve(null, null)).to.equal('/');
  });

  it('should return /dir as the common path', function () {
    expect(pathResolver.resolve('/dir')).to.equal('/dir');
  });

  it('should return /dir as the common path', function () {
    expect(pathResolver.resolve(null, '/dir')).to.equal('/dir');
  });

  it('should return /dir as the common path', function () {
    expect(pathResolver.resolve('/dir/myfile.txt', '/dir/myfile2.txt')).to.equal('/dir');
  });

  it('should return /dir as the common path', function () {
    expect(pathResolver.resolve('/dir/myfile.txt', '/dir')).to.equal('/dir');
  });

  it('should return / as the common path', function () {
    expect(pathResolver.resolve('/dir/myfile.txt', '/dir2/myfile.txt')).to.equal('/');
  });

  it('should return / as the common path', function () {
    expect(pathResolver.resolve('/', '/dir/subdir/subsubdir')).to.equal('/');
  });

  it('should return / as the common path', function () {
    expect(pathResolver.resolveFromArray([null, null])).to.equal('/');
  });

  it('should return /dir as the common path', function () {
    expect(pathResolver.resolveFromArray(['/dir'])).to.equal('/dir');
  });

  it('should return /dir as the common path', function () {
    expect(pathResolver.resolveFromArray([null, '/dir', null, '/dir/file'])).to.equal('/dir');
  });

  it('should return /dir as the common path', function () {
    expect(pathResolver.resolveFromArray(['/dir/myfile1', '/dir', '/dir/myfile2', '/dir/dir2/myfile3'])).to.equal('/dir');
  });
});
