module.exports = {

  getUserID: function( req ) {
    if ( !req.session ) {
      return null;
    }
    if ( !req.session.user ) {
      return null;
    }
    return req.session.user.id;
  },

  error: function( code, msg ) {
    var err = new Error( msg );
    err.status = code;
    return err;
  }

};
