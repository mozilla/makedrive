var fs = new Filer.FileSystem({
  provider: new Filer.FileSystem.providers.Memory()
});
var watcher;
var treeSource = [];
var connectionId;
var api = 'http://localhost:9090/api/sync/';
var source = new EventSource('/update-stream');


function u8toArray(u8) {
  var array = [];
  var len = u8.length;
  for(var i = 0; i < len; i++) {
    array[i] = u8[i];
  }
  return array;
}


source.addEventListener('message', function(e) {
var data;

  // Adding this into try-catch because it may throw an error when we send e.data as a string.
  try {
    data = JSON.parse(e.data);
    // If this is the first message, capture the connectionId
    connectionId = data.connectionId;
  } catch (e) {
    data = e.data;
  }



  // Remove this event listener now that we have connectionId
  source.removeEventListener('message', this);

  source.addEventListener('message', function(e) {
    $('#events').append('<div class="alert alert-warning">' + e.data + '</div>');
  }, false);

});

var editor = ace.edit("editor");

fs.mkdir('/projects', function (err) {

  editor.setTheme("ace/theme/clouds");
  editor.getSession().setMode("ace/mode/javascript");
  editor.getSession().setTabSize(2);

  $('#btnSave').click(function () {

    var fileName = $('#fileTitle').val();
    var value = editor.getValue();
    fs.writeFile("/projects/" + fileName, value, 'utf8', function (err) {

      $.get('http://localhost:9090/api/sync/' + connectionId, function (data) {
        if (!data.syncId) {
        } else {
          syncID = data.syncId;
        }
      }).done(function () {
        rsync.sourceList(fs, "/projects", {
          recursive: true,
          size: 5
        }, function (error, results) {
          if (error) {
          } else {
            $.ajax({
              type: 'POST',
              data: JSON.stringify({
                path: "/projects",
                srcList: results
              }),
              contentType: 'application/json',
              url: api + connectionId + '/sources',
              statusCode: {
                200: function (response) {},
                201: function (response) {},
                401: function (response) {},
                404: function (response) {}
              },
              success: function (data) {
                if (data) {

                } else {

                }
              },
              error: function (e) {
                console.log("Error " + e.messages);
              }
            }).done(f);
          }
        });
      });
    })
  });
});


var f = function () {
    $.get(api + connectionId + '/checksums', function (data) {
      console.log(data)
      if (data) {

      } else {

      }
      return data;
    }).done(function (data) {
      var checksums = data.checksums;
      rsync.diff(fs, "/projects", checksums, {
        recursive: true,
        size: 5
      }, function (error, diffs) {
        if (error) {
          console.log(error);
        } else {

          for (var i = 0; i < diffs.length; i++) {
            if (diffs[i].contents) {
              for (var j = 0; j < diffs[i].contents.length; j++) {
                for (var k = 0; k < diffs[i].contents[j].diff.length; k++) {
                  if (Object.prototype.toString.call(diffs[i].contents[j].diff[k].data) === "[object Uint8Array]") {
                    diffs[i].contents[j].diff[k].data = {
                      __isUint8Array: true,
                      __array: u8toArray(diffs[i].contents[j].diff[k].data)
                    };
                  }
                }
              }
            } else {
              for (var k = 0; k < diffs[i].diff.length; k++) {
                if (Object.prototype.toString.call(diffs[i].diff[k].data) === "[object Uint8Array]") {
                  diffs[i].diff[k].data = {
                    __isUint8Array: true,
                    __array: u8toArray(diffs[i].diff[k].data)
                  };
                }
              }
            }
          }
          $.ajax({
            type: 'PUT',
            data: JSON.stringify({
              diffs: diffs
            }),
            contentType: 'application/json',
            url: api + syncID + '/diffs',
            statusCode: {
              200: function (response) {},
              201: function (response) {},
              401: function (response) {},
              404: function (response) {}
            },
            success: function (data) {
              if (data) {

              } else {

              }
            },
            error: function (e) {
              console.log("Error " + e.messages);
            }
          })
        }
      });
    });
}