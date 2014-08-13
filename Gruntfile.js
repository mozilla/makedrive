var semver = require('semver'),
    fs = require('fs'),
    currentVersion = JSON.parse(fs.readFileSync('./package.json', 'utf8')).version,
    env = require('./server/lib/environment');

// Globals
var PROMPT_CONFIRM_CONFIG = 'confirmation',
    GIT_BRANCH = env.get('MAKEDRIVE_UPSTREAM_BRANCH'),
    GIT_REMOTE = env.get('MAKEDRIVE_UPSTREAM_REMOTE_NAME'),
    GIT_FULL_REMOTE = env.get('MAKEDRIVE_UPSTREAM_URI') + ' ' + GIT_BRANCH;


module.exports = function(grunt) {
  require('time-grunt')(grunt);
  require('jit-grunt')(grunt, {
    'checkBranch': 'grunt-npm',
    'npm-publish': 'grunt-npm',
    express: 'grunt-express-server'
  });
  grunt.initConfig({
    pkg: grunt.file.readJSON( "package.json" ),

    /**
     * Build tasks
     */
    clean: [ "client/dist/makedrive.js", "client/dist/makedrive.min.js" ],

    browserify: {
      makedriveClient: {
        src: "./client/src/index.js",
        dest: "./client/dist/makedrive.js",
        options: {
          bundleOptions: {
            standalone: "MakeDrive"
          }
        }
      }
    },

    uglify: {
      options: {
        banner: "/*! <%= pkg.name %> <%= pkg.version %> <%= grunt.template.today(\"yyyy-mm-dd\") %> */\n"
      },
      develop: {
        src: "client/dist/makedrive.js",
        dest: "client/dist/makedrive.min.js"
      },
      dependencies: {
        options: {
          sourceMap: true,
          mangle: false
        },
        files: {
          'demo/js/compiled/dependencies.min.js': [
            'client/vendors/jquery/dist/jquery.min.js',
            'client/vendors/ace-builds/src-min/ace.js',
            'client/vendors/ace-builds/src-min/theme-monokai.js',
            'client/vendors/ace-builds/src-min/mode-javascript.js',
            'client/vendors/jstree/dist/jstree.min.js',
            'client/vendors/webmaker-auth-client/dist/webmaker-auth-client.min.js',
            // angular dependencies
            'client/vendors/angular/angular.js',
            'client/vendors/angular-route/angular-route.min.js',
            '/client/vendors/angular-ui/build/angular-ui.min.js',
            'client/vendors/angular-bootstrap/ui-bootstrap.js',
            'client/vendors/angular-bootstrap/ui-bootstrap-tpls.js'
          ],
        },
      },
      angular_app: {
        options: {
          sourceMap: true,
          mangle: false
        },
        files: {
          'demo/js/compiled/app.min.js': ['demo/js/angular/*.js']
        },
      }
    },

    /**
     * Release tasks
     */

    bump: {
      options: {
        files: ['package.json', 'bower.json'],
        commit: true,
        commitMessage: 'v%VERSION%',
        commitFiles: ['package.json', 'bower.json', './client/dist/makedrive.js', './client/dist/makedrive.min.js'],
        createTag: true,
        tagName: 'v%VERSION%',
        tagMessage: 'v%VERSION%',
        push: true,
        pushTo: GIT_FULL_REMOTE
      }
    },

    'npm-checkBranch': {
      options: {
        branch: GIT_BRANCH
      }
    },

    'npm-publish': {
      options: {
        abortIfDirty: false
      }
    },

    prompt: {
      confirm: {
        options: {
          questions: [
            {
              config: PROMPT_CONFIRM_CONFIG,
              type: 'confirm',
              message: 'Bump version from ' + (currentVersion).cyan +
                          ' to ' + semver.inc(currentVersion, "patch").yellow + '?',
              default: false
            }
          ],
          then: function(results) {
            if (!results[PROMPT_CONFIRM_CONFIG]) {
              return grunt.fatal('User aborted...');
            }
          }
        }
      }
    },

    /**
     * Testing & Dev tasks
     */
    exec: {
      update_submodule: {
        command: 'git submodule update --init',
        stdout: false,
        stderr: true
      },
      npm_install_submodule: {
        command: 'cd ' + __dirname + '/client/thirdparty/filer; npm install; rm -rf client',
        stdout: false,
        stderr: true
      },
      run_mocha: {
        command: './node_modules/.bin/mocha --timeout 70000 --recursive --reporter spec ./tests',
        stdout: true,
        stderr: true
      }
    },

    jshint: {
      all: [
        "Gruntfile.js",
        "client/src/**/*.js",
        "server/**/*.js",
        "lib/**/*.js",
        "tests/unit/**/*.js",
        "tests/lib/*.js"
      ]
    },


    watch: {
      angular: {
        files: ['demo/js/angular/*.js'],
        tasks: ['uglify:angular_app'],
        options: {
          spawn: false
        }
      },
      node: {
        files: ['server/*.js', 'server/**/*.js'],
        tasks: ['express:dev'],
        options: {
          spawn: false
        }
      }
    },
    express: {
      dev: {
        options: {
          script: 'app.js',
          node_env: 'DEV',
          port: ''
        }
      }
    }
  });

  // Simple multi-tasks
  grunt.registerTask( "test", [ "jshint", "exec:run_mocha" ] );
  grunt.registerTask( "default", [ "test" ] );
  grunt.registerTask( "init", [ "exec:update_submodule", "exec:npm_install_submodule" ] );
  grunt.registerTask( "build", [ "clean", "browserify:makedriveClient", "uglify" ] );
  grunt.registerTask( "install", [ "uglify:dependencies", "uglify:angular_app" ] );
  grunt.registerTask( "dev", [ "uglify:angular_app", "express:dev", "watch" ] );

  // Complex multi-tasks
  grunt.registerTask('publish', 'Publish MakeDrive as a new version to NPM, bower and github.', function(patchLevel) {
    var allLevels = ['patch', 'minor', 'major'];

    patchLevel = (patchLevel || 'patch').toLowerCase();

    // Fail out if the patch level isn't recognized
    if (allLevels.filter(function(el) { return el == patchLevel; }).length === 0) {
      return grunt.fatal('Patch level not recognized! "Patch", "minor" or "major" only.');
    }

    // Set prompt message
    var promptOpts = grunt.config('prompt.confirm.options');
    promptOpts.questions[0].message =  'Bump version from ' + (currentVersion).cyan +
      ' to ' + semver.inc(currentVersion, patchLevel).yellow + '?';
    grunt.config('prompt.confirm.options', promptOpts);

    grunt.task.run([
      'prompt:confirm',
      'checkBranch',
      'build',
      'bump:' + patchLevel,
      'npm-publish'
    ]);
  });
};
