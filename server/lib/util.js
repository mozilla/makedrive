module.exports = {

toArrayBuffer: function (buffer) {
   var ab = new ArrayBuffer(buffer.length);
   var view = new Uint8Array(ab);
   var bufLen = buffer.length;
   for (var i = 0; i < bufLen; ++i) {
       view[i] = buffer[i];
   }
   return view;
 }

};
