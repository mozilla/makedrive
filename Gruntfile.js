module.exports = function(grunt) {

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    clean: ['dist/'],

    uglify: {
      options: {
        banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mm-dd") %> */\n'
      },
      develop: {
        src: 'dist/makedrive.js',
        dest: 'dist/makedrive.min.js'
      }
    },

    jshint: {
      all: [
        'Gruntfile.js',
        'client/src/**/*.js'
      ]
    },

    requirejs: {
      develop: {
        options: {
          paths: {
            // Use Filer's src dir so we can include Filer's src/ dir easily
            "src": "../src",
            "makedrive": "../../../src"
          },
          // Filer's require paths are odd, work around them
          baseUrl: "client/thirdparty/filer/lib",
          name: "../build/almond",
          include: ["makedrive/index"],
          out: "dist/makedrive.js",
          optimize: "none",
          wrap: {
            startFile: 'client/build/wrap.start',
            endFile: 'client/build/wrap.end'
          },
          shim: {
            // TextEncoder and TextDecoder shims. encoding-indexes must get loaded first,
            // and we use a fake one for reduced size, since we only care about utf8.
            "filer/lib/encoding": {
              deps: ["filer/lib/encoding-indexes-shim"]
            }
          }
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-requirejs');
  grunt.loadNpmTasks('grunt-contrib-jshint');

  grunt.registerTask('develop', ['clean', 'requirejs']);
  grunt.registerTask('release', ['develop', 'uglify']);
  grunt.registerTask('check', ['jshint']);
  grunt.registerTask('test', ['check']);

  grunt.registerTask('default', ['develop']);
};
