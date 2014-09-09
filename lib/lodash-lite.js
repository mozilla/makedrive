module.exports = {
  difference: function(arr,farr) {
    return arr.filter(function(v) {
      return farr.indexOf(v) === -1;
    });
  },
  sortBy: function(list,prop) {
    return list.sort(function(a,b) {
      a = a[prop];
      b = b[prop];
      return (a === b) ? 0 : (a < b) ? -1 : 1;
    });
  },
  isArray: Array.isArray || function(obj) {
    return toString.call(obj) === '[object Array]';
  },
  map: function(input, fn) {
    if (this.isArray(input)) {
      return input.map(fn);
    }
    return Object.keys(input).map(function(v) {
      return fn(input[v]);
    });
  },
  values: function(obj) {
    return Object.keys(obj).map(function(v) {
      return obj[v];
    });
  }
};
