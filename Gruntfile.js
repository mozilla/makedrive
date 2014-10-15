var semver = require('semver'),
    fs = require('fs'),
    currentVersion = JSON.parse(fs.readFileSync('./package.json', 'utf8')).version,
    env = require('./server/lib/environment');

// Globals
var PROMPT_CONFIRM_CONFIG = 'confirmation',
    GIT_BRANCH = env.get('MAKEDRIVE_UPSTREAM_BRANCH'),
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
          browserifyOptions: {
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
            'client/vendors/filer-dialogs/filer-dialogs.js',
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

    less: {
      dist: {
        options: {
          compile: true,
          compress: true,
          modifyVars: {
            'fa-font-path': "'/vendors/font-awesome/fonts'",
            'makerstrap-bower-path': "'client/vendors'"
          }
        },
        files: {
          'demo/assets/css/main.css': ['demo/assets/less/main.less']
        }
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
        commitFiles: [
          'package.json', 'bower.json', './client/dist/makedrive.js',
          './client/dist/makedrive.min.js', './demo/js/compiled/app.min.js',
          './demo/js/compiled/app.min.map', './demo/js/compiled/dependencies.min.js',
          './demo/js/compiled/dependencies.min.map', './demo/assets/css/main.css'
        ],
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
      run_mocha: {
        command: '"./node_modules/.bin/mocha" --timeout 70000 --recursive --reporter spec ./tests | ./node_modules/.bin/bunyan -l fatal',
        stdout: true,
        stderr: true
      }
    },
    
    jshint: {
      options: {
        eqeqeq: true,
        forin: true,
        immed: true,
        indent: 2,
        latedef: true,
        noarg: true,
        nonew: true,
        plusplus: false,
        undef: true,
        unused: 'vars',
        trailing: true,
        expr: true,
        "-W004": true,
        node: true,
        browser: true,
        globals: {
          /* MOCHA */
          "describe"   : false,
          "it"         : false,
          "before"     : false,
          "beforeEach" : false,
          "after"      : false,
          "afterEach"  : false
        }
// Other JSHint options that would be nice to do some day:
// https://github.com/mozilla/makedrive/issues/429
//      quotmark: 'single',
//      strict: true,
//      curly: true,
//      maxdepth: 4,
      },
      all: [
        "Gruntfile.js",
        "client/src/**/*.js",
        "server/**/*.js",
        "lib/**/*.js",
        "tests/**/**/*.js"
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
      makeDriveClient: {
        files: ['client/src/*.js'],
        tasks: ["makedriveClient"],
        options: {
          spawn: false
        }
      },
      less: {
        files: ['demo/assets/less/*'],
        tasks: ['less:dist'],
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
  grunt.registerTask( "build", [ "clean", "browserify:makedriveClient", "uglify" ] );
  grunt.registerTask( "makedriveClient", [ "clean", "browserify:makedriveClient", "uglify:develop" ] );
  grunt.registerTask( "dev", [ "less", "uglify:angular_app", "build", "express:dev", "watch" ] );

  // Complex multi-tasks
  grunt.registerTask('publish', 'Publish MakeDrive as a new version to NPM, bower and github.', function(patchLevel) {
    var allLevels = ['patch', 'minor', 'major'];

    patchLevel = (patchLevel || 'patch').toLowerCase();

    // Fail out if the patch level isn't recognized
    if (allLevels.filter(function(el) { return el === patchLevel; }).length === 0) {
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
