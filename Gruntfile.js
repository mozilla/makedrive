module.exports = function(grunt) {

  grunt.initConfig({
    pkg: grunt.file.readJSON( "package.json" ),

    jshint: {
      all: [
        "Gruntfile.js",
        "client/src/**/*.js",
        "server/**/*.js",
        "lib/**/*.js"
      ]
    },

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
      }
    },

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
      }
    }

  });

  grunt.loadNpmTasks( "grunt-contrib-jshint" );
  grunt.loadNpmTasks( "grunt-contrib-clean" );
  grunt.loadNpmTasks( "grunt-contrib-uglify" );
  grunt.loadNpmTasks( "grunt-browserify" );
  grunt.loadNpmTasks( "grunt-exec" );

  grunt.registerTask( "test", [ "jshint" ] );
  grunt.registerTask( "default", [ "test" ] );
  grunt.registerTask( "init", [ "exec" ] );
  grunt.registerTask( "build", [ "clean", "browserify:makedriveClient", "uglify" ] );
};
