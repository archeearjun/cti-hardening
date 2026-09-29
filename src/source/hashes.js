

export function sha256Text_(text) {
    if (!globalThis.crypto || !globalThis.crypto.subtle || typeof TextEncoder === 'undefined') return Promise.resolve('');
    return globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || ''))).then(function(buffer) {
      return Array.from(new Uint8Array(buffer)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    }).catch(function() { return ''; });
 }

export function sha256Bytes_(buffer) {
    if (!globalThis.crypto || !globalThis.crypto.subtle || !buffer) return Promise.resolve('');
    return globalThis.crypto.subtle.digest('SHA-256', buffer).then(function(hashBuffer) {
      return Array.from(new Uint8Array(hashBuffer)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    }).catch(function() { return ''; });
 }

export async function perceptualHashBlob_(blob) {
    if (!blob || typeof createImageBitmap !== 'function') return '';
    try {
      var bitmap = await createImageBitmap(blob);
      var canvas = document.createElement('canvas');
      canvas.width = 9; canvas.height = 8;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, 9, 8);
      if (bitmap.close) bitmap.close();
      var data = ctx.getImageData(0, 0, 9, 8).data;
      var gray = [];
      for (var i = 0; i < data.length; i += 4) gray.push((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114));
      var bits = '';
      for (var y = 0; y < 8; y++) {
        for (var x = 0; x < 8; x++) {
          var left = gray[(y * 9) + x], right = gray[(y * 9) + x + 1];
          bits += left > right ? '1' : '0';
        }
      }
      return bits;
    } catch (e) {
      return '';
    }
 }
