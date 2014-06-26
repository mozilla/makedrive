var count = 1;
var files = [];
var currentPath;
$(document).ready(function() {
  var editor = ace.edit(document.getElementById('editor'));
  editor.setTheme("ace/theme/monokai");
  editor.getSession().setMode("ace/mode/javascript");
  var Filer = makedrive.Filer;
  var fs = new Filer.FileSystem({provider: new Filer.FileSystem.providers.Memory("B")});
  fs.mkdir('/projects', function(err) {
    if(err) {
      return console.error(err);
    }
    files.push('projects');
    var uri = 'http://localhost:9090';
    makedrive.init(uri, fs, function(err) {
      if(err) {
        return console.error(err);
      }
      fs.watch('/projects', {recursive: true}, function(event, filename) {
        var found = false;
        var fname = filename.replace(/^\//, "");
        fname = Filer.Path.basename(fname);
        if(currentPath === fname) {
          fs.readFile('/projects/' + currentPath, 'utf8', function(err, data) {
            if(err) {
              return console.error(err);
            }
            editor.setValue(data);
            $('#fileTitle').val(fname);
          });
        }
        if(files.indexOf(fname) < 0) {
          $('#files').append('<li><span class="file"><span class=padding>' + fname + "</span></span></li>");
          $('.file').unbind('click').click( function(e) {
            currentPath = e.target.innerHTML;
            fs.readFile('/projects/' + e.target.innerHTML, 'utf8', function(err, data) {
              if(err) {
                return console.error(err);
              }
              editor.setValue(data);
              $('#fileTitle').val(e.target.innerHTML);
            });
          });
          files.push(fname);
        }
      });
      $('.file').unbind('click').click( function(e) {
        currentPath = e.target.innerHTML;
        fs.readFile('/projects/' + e.target.innerHTML, 'utf8', function(err, data) {
          if(err) {
            return console.error(err);
          }
          editor.setValue(data);
          $('#fileTitle').val(e.target.innerHTML);
        });
      });
      $('#btnSave').unbind("click").click(function(e) {
        var fname = $('#fileTitle').val() || ('new-file' + count++);
        var contents = editor.getValue();
        fs.writeFile('/projects/' + fname, contents, function(err) {
          if(err) {
            return console.error(err);
          }
          if(files.indexOf(fname) < 0) {
            files.push(fname);
            $('#files').append('<li><span class="file">' + fname + "</span></li>");
          }
          currentPath = fname;
          makedrive.sync('/projects', function(err) {
            if(err) {
              return console.error(err);
            }
            fs.readFile('/projects/' + currentPath, 'utf8', function(err, data) {
              if(err) {
                return console.error(err);
              }
              editor.setValue(data);
              $('#fileTitle').val(currentPath);
            });
          });
        });
      });
    });
  });
});