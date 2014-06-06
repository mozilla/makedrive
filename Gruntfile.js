module.exports = function(grunt) {

  grunt.initConfig({
    pkg: grunt.file.readJSON( "package.json" ),

    jshint: {
      all: [
        "Gruntfile.js",
        "client/src/**/*.js",
        "server/**/*.js"
      ]
    },

    clean: [ "client/dist/makedrive.js", "client/dist/makedrive.min.js" ],

    browserify: {
      makedriveClient: {
        src: "./client/src/index.js",
        dest: "./client/dist/makedrive.js",
        options: {
          bundleOptions: {
            standalone: "makedrive"
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

  });

  grunt.loadNpmTasks( "grunt-contrib-jshint" );
  grunt.loadNpmTasks( "grunt-contrib-clean" );
  grunt.loadNpmTasks( "grunt-contrib-uglify" );
  grunt.loadNpmTasks( "grunt-browserify" );

  grunt.registerTask( "test", [ "jshint" ] );
  grunt.registerTask( "default", [ "test" ] );
  grunt.registerTask( "build", [ "clean", "browserify:makedriveClient", "uglify" ] );
};
