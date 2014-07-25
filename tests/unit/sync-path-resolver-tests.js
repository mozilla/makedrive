var expect = require('chai').expect;
var pathResolver = require('../../lib/sync-path-resolver.js');
var resolvePath = pathResolver.resolve;
var filterSynced = pathResolver.filterSynced;

describe('Resolution path tests', function(){
  it('should return /dir', function() {
    expect(resolvePath([ '/dir' ])).to.equal('/dir');
  });

  it('should return /file', function() {
    expect(resolvePath([ '/', '/file' ])).to.equal('/file');
  });

  it('should return /', function() {
    expect(resolvePath([ '/dir', '/dir2',
                        '/dir/file.txt', '/', '/hello.js' ])).to.equal('/');
  });

  it('should return /dir', function() {
    expect(resolvePath([ '/dir', '/dir', '/dir/test.js',
                        '/dir/test', '/dir/test/test',
                        '/dir/test/test', '/dir/test/test/test.js' ])).to.equal('/dir');
  });

  it('should return /', function() {
    expect(resolvePath([ '/dir', '/dir2', '/dir', '/dir/test.js',
                        '/dir3', '/dir3', '/dir3/test.js',
                        '/dir/test', '/dir/test/test',
                        '/dir/test/test', '/dir/test/test/test.js' ])).to.equal('/');
  });

  it('should return /', function() {
    expect(resolvePath([ '/', '/test.js', '/dir', '/dir', '/dir/test.js',
                        '/', '/myname.txt', '/dir2', '/dir2/test',
                        '/dir2/test', '/dir2/test/text.txt'  ])).to.equal('/');
  });

  it('should return /folder/inside/folder/abc.txt', function() {
    expect(resolvePath([ '/folder/inside/folder',
                        '/folder/inside/folder/abc.txt'
                        ])).to.equal('/folder/inside/folder/abc.txt');
  });

  it('should return /folder/inside/folder', function() {
    expect(resolvePath([ '/folder/inside/folder', '/folder/inside/folder/abc.txt',
                        '/folder/inside/folder', '/folder/inside/folder/text.txt'
                        ])).to.equal('/folder/inside/folder');
  });
});

describe('Filter synced path tests', function() {
  it("should return []", function() {
    expect(filterSynced(['/dir'], ['/dir'])).to.have.members([]);
  });

  it("should return ['/']'", function() {
    expect(filterSynced(['/', '/file'], ['/file'])).to.have.members([]);
  });

  it("should return ['/', '/dir2', '/hello.js']", function() {
    expect(filterSynced(['/dir', '/dir2', '/dir/file.txt', '/', '/hello.js'], 
      ['/dir3', '/dir/file.txt']))
    .to.have.members(['/', '/dir2', '/hello.js']);
  });
  
  it("should return ['/dir', '/dir', '/dir/test.js', '/dir/test/test', '/dir/test/test/test.js']", function() {
    expect(filterSynced(['/dir', '/dir', '/dir/test.js', '/dir/test', 
      '/dir/test/test', '/dir/test/test', '/dir/test/test/test.js'], 
      ['/dir3', '/dir/test/test']))
    .to.have.members(['/dir', '/dir', '/dir/test.js', '/dir/test/test', 
      '/dir/test/test/test.js']);
  });
});

