// General utility methods

function findPathIndexInArray(array, path) {
  for(var i = 0; i < array.length; i++) {
    if(array[i].path === path) {
      return i;
    }
  }

  return -1;
}

module.exports = {
    findPathIndexInArray: findPathIndexInArray
};
