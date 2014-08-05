// Filer doesn't expose the Shell() ctor directly, so provide a shortcut.
// See client/src/sync-filesystem.js
module.exports = require('../client/thirdparty/filer/src/shell/shell.js');
