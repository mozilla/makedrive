/**
 * Sync path resolver is a library that provides
 * functionality to determine 'syncable' paths
 * It exposes two methods:
 *
 * resolve      - This method takes an array of paths as
 *                an argument which represents the paths
 *                that were modified in a Makedrive fs.
 *                The array is populated with every path picked
 *                up by watch events. This results in the array
 *                including parent paths for files as well.
 *                Resolve thus returns a single path which indicates
 *                the most common path between every path that was modified
 *                For example, if I created a file '/myfile.txt', the 'syncable'
 *                path would be '/myfile.txt'. If I created another file as well,
 *                '/myfile_2.txt', the 'syncable' path then becomes '/'.
 *
 * filterSynced - This method takes two arguments. The first is an array
 *                populated with Makedrive watch events. The second is an
 *                array of recently synced paths. This method returns a single
 *                array representing the modified paths without including the
 *                synced paths. However, the returned array will still have the
 *                same format as if picked up by watch events.
*/

var pathResolver = {};
var Path = require('./filer').Path;

function getPathSegments(absPath) {
  if(absPath !== '/') {
    return getPathSegments(Path.dirname(absPath))
    .concat(Path.basename(absPath));
  }

  return ['/'];
}

function cleanup(dirtyArray) {
  var result = [];

  dirtyArray.forEach(function(element, index, array) {
    if(dirtyArray[index]) {
      result.push(dirtyArray[index]);
    }
  });

  return result;
}

// Constructs a 2-D variable length array
// where each element in the first dimension
// represents an array of paths determined by
// the correlation between the index of the first
// dimension in which the array of paths exists
// and the number of '/'s in each path of that array
// of paths
// Holes in the 1-D array can exist anywhere. For e.g.,
// [undefined, undefined, Array, Array] is possible
function constructBuckets(pathList) {
  var pathBucketArray = [];

  function createBucketForList(pathElement, index, list) {
    var depth;

    if(pathElement === '/') {
      depth = 0;
    } else {
      depth = pathElement.match(/\//g).length;
    }

    if(!pathBucketArray[depth]) {
      pathBucketArray[depth] = [];
    }

    pathBucketArray[depth].push(pathElement);
  }

  pathList.forEach(createBucketForList);

  pathBucketArray = cleanup(pathBucketArray);

  return pathBucketArray;
}

function getCommonPathAncestor(path1, path2) {
  path1 = getPathSegments(path1);
  path2 = getPathSegments(path2);

  for (var commonIndex = 0; commonIndex < path1.length && 
    commonIndex < path2.length && 
    path1[commonIndex] === path2[commonIndex]; commonIndex++);

  commonIndex--;

  return '/' + path1.slice(1, commonIndex + 1).join('/');
}

function getRegressedPath(pathList) {
  var regressedPath = pathList[0];

  for (var i = 1; i < pathList.length; i++) {
    regressedPath = getCommonPathAncestor(regressedPath, pathList[i]);
  }

  return regressedPath;
}

// Paths is an array containing paths and their parent paths
pathResolver.resolve = function(paths) {

  if(!paths.length) {
    return '/';
  }

  // A 2-D array containing paths organized in
  // descending order according to their depths
  var pathBucketList = constructBuckets(paths);
  var regressedPath = '/';
  var fullPath;
  // Paths that were modified, arranged in descending
  // order of their depth
  var modifiedPaths = [];
  var dirs, parentBucket;

  // Construct a 1-D array of paths that were modified
  // This is done to remove the paths that were added
  // by fs.watch for parent node changes
  for(var i = pathBucketList.length - 1; i >= 0; i--) {
    for(var j = 0; pathBucketList[i] && j < pathBucketList[i].length; j++) {
      fullPath = pathBucketList[i][j];
      modifiedPaths.push(fullPath);

      // Get the parent path and remove an entry of it
      // from the corresponding bucket
      dir = Path.dirname(fullPath);
      parentBucket = pathBucketList[i-1];

      if(parentBucket) {
        parentIndex = parentBucket.indexOf(dir);

        if(parentIndex >= 0) {
          parentBucket.splice(parentIndex, 1);
        }
      }
    }
  }

  regressedPath = getRegressedPath(modifiedPaths);

  return regressedPath;
};

pathResolver.filterSynced = function(paths, syncedPaths) {
  var repeatedPath, repeatedParentIndex;

  for(var i = 0; i < syncedPaths.length; i++) {
    repeatedPath = syncedPaths[i];
    for(var j = 0; j < paths.length; j++) {
      if(paths[j] == repeatedPath) {
        paths.splice(j, 1);
        repeatedParentIndex = paths.indexOf(Path.dirname(repeatedPath));
        if(repeatedParentIndex >= 0) {
          paths.splice(repeatedParentIndex, 1);
        }
        continue;
      }
    }
  }

  return paths;
};

module.exports = pathResolver;
