angular
  .module('makedriveApp.services', [])
  .factory('getList', [
    '$rootScope',
    '$http',
    '$window',
    function($rootScope, $http, $window) {
      var fs = $window.MakeDrive.fs({
        manual: true
      });
      var sh = $window.MakeDrive.fs().Shell();
      var sync = fs.sync;

      function getContent(data) {
        var listing = [];
        data.map(function(content) {
          var node;
          if (content.type !== "DIRECTORY") {
            node = {
              text: content.path,
              icon: "/demo/assets/document.png"
            };
          } else {
            node = {
              text: content.path
            };
          }
          if (content.contents) {
            node.children = getContent(content.contents);
          }
          listing.push(node);
        });
        return listing;
      }

      function openFile() {
        fs.stat($rootScope.selectedPath, function(e, stat) {
          if (e) {
            return;
          }
          if (!stat.isDirectory()) {
            fs.readFile($rootScope.selectedPath, 'utf8', function(e, data) {
              if (e) {
                return;
              } else {
                $window.editor.setValue(data);
              }
            });
          }
        });
      }

      function remove() {
        fs.stat($rootScope.selectedPath, function(e, stat) {
          if (!stat.isDirectory()) {
            fs.unlink($rootScope.selectedPath, function(e) {
              if (e) {
                alert(e);
              }
              sync.request('/');

            });
          } else {
            sh.rm($rootScope.selectedPath, {
              recursive: true
            }, function(e) {
              if (e) {
                alert(e);
              }
              sync.request('/');
            });
          }
        });
      }

      function createTree(data) {
        $("#jstree").jstree({
          "plugins": ["contextmenu"],
          "contextmenu": {
            "items": function($node) {
              return {
                "Delete": {
                  "label": "Delete",
                  "action": function(obj) {
                    remove();
                  }
                }
              };
            }
          },
          'core': {
            'multiple': false,
            'data': [{
              'text': '/',
              'state': {
                'opened': true,
                'selected': false
              },
              'children': data
            }]
          }
        }).bind("select_node.jstree", function(e, data) {
          var Path = $window.MakeDrive.Path;
          $rootScope.selectedPath = Path.normalize(data.instance.get_path(data.node).join('/'));
          openFile();
        });
        jQuery.jstree.reference("#jstree").refresh();
      }

      getListing = function() {
        if(jQuery.jstree.reference("#jstree")) {
          jQuery.jstree.reference("#jstree").destroy();
        }
        $http
          .get('/j/')
          .success(function(data) {
            newListing = getContent(data);
            createTree(newListing);
          });
      }
      return getListing;
    }
  ])
  .factory('param', ['$window',
    function ($window) {
      getParam = function(name) {
        var results = new RegExp('[\?&]' + name + '=([^&#]*)').exec($window.location.href);
        if (results == null) {
          return null;
        } else {
          return results[1] || 0;
        }
      }
      return getParam;
    }
  ]);
