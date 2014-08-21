module.exports = {
  difference: function(arr,farr) {
    return arr.filter(function(v) {
      return farr.indexOf(v) === -1;
    });
  }
};
