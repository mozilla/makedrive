$(document).ready(function() {
  var editor = ace.edit(document.getElementById('editor'));
  editor.setTheme("ace/theme/monokai");
  editor.getSession().setMode("ace/mode/javascript");
  var fs = MakeDrive.fs();
  var sync = fs.sync;


  // TODO: Maybe use an XHR or something else other than this?
  $.get( "http://localhost:9090/api/sync", function( data ) {
    fs.sync.connect('ws://localhost:9090', data);
  });

  var sync = fs.sync;

  //TODO: Do we want to do anything other than console.log for all these events?
  sync.on('syncing', function() {
      console.log('sync started');
  });
  sync.on('error', function(e) {
      console.log('sync error: ', e);
  });
  sync.on('completed', function() {
      console.log('sync completed');
  });
  sync.on('updates', function() {
      console.log('server has updates');
  });

  sync.on('connected', function() {
      console.log('server has connected');
  });

});