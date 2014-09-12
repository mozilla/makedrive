angular.module('makedriveApp')
  .controller('editor', ['$window',
    function($window) {
      ace.config.set("basePath", "/vendors/ace-builds/src-min")
      $window.editor = ace.edit(document.getElementById('editor'));
      editor.setTheme("ace/theme/monokai");
      editor.getSession().setMode("ace/mode/javascript");
    }
  ])
  .controller('make', ['$window', '$scope', '$rootScope', 'getList',
    function($window, $scope, $rootScope, Make) {
      var prev;
      var sh = $window.MakeDrive.fs().Shell();
      var Path = $window.MakeDrive.Path;
      var fs = $window.MakeDrive.fs({
        manual: true
      });
      var sync = fs.sync;
      $scope.mkfile = function() {
        $window.filerDialogs.showSaveAsDialog("Create new file", "/", "name", function(error, path) {
          sh.mkdirp(Path.dirname(path), function(e, d) {
            if (e) {
              console.error(e);
            }

            fs.writeFile(path, $window.editor.getValue(), function(e) {
              if (e) {
                console.error(e);
              }
              $rootScope.$emit("mkfile", path);
              sync.request();
            });
          });
        });
      }
      $scope.save = function() {
        if($rootScope.canSave) {
          fs.writeFile($rootScope.selectedPath, $window.editor.getValue(), function(e) {
            if (e) {
              console.error(e);
            }
            $rootScope.$emit("mkfile", $rootScope.selectedPath);
            sync.request();
            $rootScope.canSave = false;
          });
        }
      }
      $scope.rename = function() {
        if($rootScope.canSave) {
          var dirname = Path.dirname($rootScope.selectedPath);
          var basename = Path.basename($rootScope.selectedPath);
          var path = prompt("Rename", basename);
          var newPath = Path.join(dirname, path)
          if (path != null) {
            fs.rename($rootScope.selectedPath, newPath, function(e) {
             $rootScope.$emit("mkfile", newPath);
              sync.request();
            });
          }
        }
      }
      $scope.delete = function() {
        if($rootScope.selectedPath) {
          Make.remove();
        }
      }
      $rootScope.open = function() {
        $window.filerDialogs.showOpenDialog(false, false, "Open file", "/", "", function(e, d) {
          fs.readFile(d[0], 'utf8', function(e, data) {
            if (e) {
              return;
            } else {
              $window.editor.setValue(data);
              prev = jQuery.jstree.reference("#jstree").get_selected();
              jQuery("#jstree").jstree("deselect_node", prev);
              jQuery("#jstree").jstree("select_node", d[0]);
            }
          });
        })
      }
    }
  ])
  .controller('clickToggle', ['$scope',
    function($scope) {
      $scope.toggled = false;
      $scope.toggle = function() {
        $scope.toggled = !$scope.toggled;
        $("#wrapper").toggleClass("toggled");
      }
    }
  ])
  .controller('init', ['getList', '$window', '$scope', 'param', '$rootScope',
    function(Make, $window, $scope, param, $rootScope) {
      var fs = $window.MakeDrive.fs({
        manual: true
      });
      var sh = $window.MakeDrive.fs().Shell();
      var sync = fs.sync;
      sync.on('connected', function() {
        Make.getListing();
        console.log('server has connected');
      });
      sync.on('syncing', function(){
        console.log('syncing in progress');
      });
      sync.on('reconnecting', function(){
        console.log('reconnecting');
      });
      sync.on('reconnect_failed', function() {
        console.log('reconnect_failed');
      });
      sync.connect(param('makedrive'));
      $rootScope.$on("mkfile", function(e, path) {
        // Need to wait till the tree refresh then we select the node again
        setTimeout(function() {
          var prev;
          if(jQuery.jstree.reference("#jstree")) {
            prev = jQuery.jstree.reference("#jstree").get_selected();
          }
          jQuery("#jstree").jstree("deselect_node", prev);
          jQuery("#jstree").jstree("select_node", path);

        }, 500);
      });
      sync.on('completed', function() {
        Make.getListing();
        $( "#success" ).fadeIn(1000);
        $( "#success" ).fadeOut(5000);
      });
      sync.on('error', function(e) {
        // Try to get better info from the error object
        if(e.code && e.message) {
           e = 'Error code: ' + e.code + ' - ' + e.message;
        } else if(e.stack) {
           e = e.stack;
        } else if(e.data) {
           e = e.data;
        } else if(e.error) {
           e = e.error;
        }
        console.error(e);
        $scope.error = e.stack;
        $( "#error" ).fadeIn(1000);
        $( "#error" ).fadeOut(5000);
      });
    }
  ]);
