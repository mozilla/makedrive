var fs = new Filer.FileSystem({
  provider: new Filer.FileSystem.providers.Memory()
});
var makedriveOptions = {
  fs: fs,
  recursive: true,
  size: 5,
  time: true
};
var watcher;
var treeSource = [];
var connectionId;
var api = '/api/sync/';
var source = new EventSource('/api/sync/updates');
var request = window.superagent;

function u8toArray(u8) {
  var array = [];
  var len = u8.length;
  for (var i = 0; i < len; i++) {
    array[i] = u8[i];
  }
  return array;
}

source.addEventListener('message', function (e) {
  var data;

  // Adding this into try-catch because it may throw an error when we send e.data as a string.
  try {
    data = JSON.parse(e.data);
    // If this is the first message, capture the connectionId
    connectionId = data.syncId;
    // TODO: use browserified client makedrive code
    // Pseudo code
    comms(makedriveOptions, function() {
      
    });
  } catch (e) {
    data = e.data;
  }

  // Remove this event listener now that we have connectionId
  source.removeEventListener('message', this);
  source.addEventListener('message', function (e) {
    $('#events').append('<div class="alert alert-warning">' + e.data + '</div>');
  }, false);

});

fs.mkdir('/projects', function (err) {

  $('#btnSave').click(function () {

    var fileName = $('#fileTitle').val();
    var val = $('#editor').val();
    fs.writeFile("/projects/" + fileName, val, 'utf8', function (err) {
      fs.writeFile("/projects/file/" + fileName, val, 'utf8', function (err) {

        request.get('/api/sync/' + connectionId, function (res) {
          try {
            data = JSON.parse(res.text);
          } catch (e) {}
          if (!data.syncId) {} else {
            syncID = data.syncId;
          }
          console.log(data)
          rsync.sourceList(fs, "/projects", {
            recursive: true,
            size: 5
          }, function (error, results) {
            if (error) {} else {
              data = {
                path: "/projects",
                srcList: results
              };
              request.post(api + connectionId + '/sources', data, function (err, res) {
                if (res.status == 200 || res.status == 201) {
                  f();
                }
              });
            }
          });
        });
      })
    });
  });
});

var f = function () {
  request.get(api + connectionId + '/checksums', function (res) {
    try {
      data = JSON.parse(res.text);
    } catch (e) {
      data = res.text;
    }

    var checksums = data.checksums;
    rsync.diff(fs, "/projects", checksums, {
      recursive: true,
      size: 5
    }, function (error, diffs) {
      if (error) {
        console.log(error);
      } else {

        var req = request.put(api + syncID + '/diffs')
          .field('user[diffs]', JSON.stringify(diffs));

        // Parse JSON diffs to Uint8Array
        for (var i = 0; i < diffs.length; i++) {
          if (diffs[i].contents) {
            for (var j = 0; j < diffs[i].contents.length; j++) {
              for (var k = 0; k < diffs[i].contents[j].diff.length; k++) {
                if (diffs[i].contents[j].diff[k].data) {
                  req.attach('webmasterfile', new Blob([diffs[i].contents[j].diff[k].data], {
                    type: 'application/octet-binary'
                  }), diffs[i].contents[k].diff[k].path)
                  delete diffs[i].contents[j].diff[k].data;
                }
              }
            }
          } else {
            for (var k = 0; k < diffs[i].diff.length; k++) {
              if (diffs[i].diff[k].data) {
                req.attach('webmasterfile', new Blob([diffs[i].diff[k].data], {
                  type: 'application/octet-binary'
                }), diffs[i].diff[k].path)
                delete diffs[0].diff[0].data;
              }
            }
          }
        }
        req.end();
      }
    });
  });
}
