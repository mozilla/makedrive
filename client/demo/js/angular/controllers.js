angular.module('makedriveApp')
  .controller('editor', ['$window',
    function($window) {
      ace.config.set("basePath", "/vendors/ace-builds/src-min")
      $window.editor = ace.edit(document.getElementById('editor'));
      editor.setTheme("ace/theme/monokai");
      editor.getSession().setMode("ace/mode/javascript");
    }
  ])
  .controller('mkdir', ['$window', '$scope',
    function($window, $scope) {
      $scope.mkdirp = function(path) {
        var sh = $window.MakeDrive.fs().Shell();
        var fs = $window.MakeDrive.fs({
          manual: true
        });
        var sync = fs.sync;
        sh.mkdirp('/' + path, function(e, d) {
          if (e) {
            console.error(e);
          }
          sync.request('/');
        })
      }
    }
  ])
  .controller('mkfile', ['$window', '$scope',
    function($window, $scope) {
      $scope.mkfile = function(path) {
        var sh = $window.MakeDrive.fs().Shell();
        var Path = $window.MakeDrive.Path;
        var fs = $window.MakeDrive.fs({
          manual: true
        });
        var sync = fs.sync;
        sh.mkdirp('/' + Path.dirname(path), function(e, d) {
          if (e) {
            console.error(e);
          }

          fs.writeFile('/' + path, $window.editor.getValue(), function(e) {
            if (e) {
              console.error(e);
            }
            sync.request('/');
          });
        });
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
  .controller('init', ['getList', '$window', '$scope', 'param',
    function(getList, $window, $scope, param) {
      var fs = $window.MakeDrive.fs({
        manual: true
      });
      var sync = fs.sync;
      sync.on('connected', function() {
        getList();
        console.log('server has connected');
      });
      sync.connect(param('makedrive'));

      sync.on('completed', function() {
        getList();
        $('#success').fadeIn(1000);
        $( "#success" ).fadeOut(5000);
      });
      sync.on('error', function(e) {
        $scope.error = e.message;
        $('#error').fadeIn(1000);
        $( "#error" ).fadeOut(5000);
      });
    }
  ]);
