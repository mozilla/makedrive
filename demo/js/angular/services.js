angular
  .module('makedriveApp.services', [])
  .factory('getList', [
    '$rootScope',
    '$http',
    '$window',
    function($rootScope, $http, $window) {
      var Make = {};
      $rootScope.canSave = false;
      var fs = $window.MakeDrive.fs({
        manual: true,
        autoReconnect: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 1500,
        reconnectAttempts: 20
      });
      var sh = $window.MakeDrive.fs().Shell();
      var sync = fs.sync;
      var Path = $window.MakeDrive.Path;
      var currentPath;
      function getContent(data) {
        var listing = [];
        data.map(function(content, index) {
          if(index != 0) {
            currentPath = "/";
          }
          currentPath = Path.join(currentPath || "/", content.path);
          var node;
          if (content.type !== "DIRECTORY") {
            node = {
              text: content.path,
              icon: "/demo/assets/icons/document.png",
              id: currentPath
            };
          } else {
            node = {
              text: content.path,
              id: currentPath
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
          if (!stat.isDirectory() && $rootScope.selectedPath) {
            $rootScope.canSave = true;
            $rootScope.$apply();
            fs.readFile($rootScope.selectedPath, 'utf8', function(e, data) {
              if (e) {
                return;
              } else {
                $window.editor.setValue(data);
              }
            });
          } else {
            $rootScope.canSave = false;
            $rootScope.$apply();
          }
        });
      }

      Make.remove = function() {
        fs.stat($rootScope.selectedPath, function(e, stat) {
          if (!stat.isDirectory()) {
            fs.unlink($rootScope.selectedPath, function(e) {
              $rootScope.selectedPath = null;
              $rootScope.canSave = false;
              $rootScope.$apply();
              sync.request();
            });
          } else {
            sh.rm($rootScope.selectedPath, {
              recursive: true
            }, function(e) {
              $rootScope.selectedPath = null;
              $rootScope.canSave = false;
              $rootScope.$apply();
              sync.request('/');
            });
          }
        });
      }

      function createTree(data) {
        $("#jstree").jstree({
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
          $rootScope.selectedPath = Path.normalize(data.instance.get_path(data.node).join('/'));
          openFile();
        });
        jQuery.jstree.reference("#jstree").refresh();
      }

      Make.getListing = function() {
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
      return Make;
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
