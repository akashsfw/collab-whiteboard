/**
 * Compresses and downscales an image File, Blob, or base64 DataURL
 * to prevent mobile GPU canvas memory exhaustion and WebSocket payload overflow.
 *
 * Max dimension: 1200px (retina-crisp on whiteboards while keeping size < 150 KB)
 * Quality: 0.82 WebP (fallback to JPEG)
 */
export async function compressImage(source, maxDim = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    let srcUrl = '';
    let shouldRevoke = false;

    if (source instanceof Blob || source instanceof File) {
      srcUrl = URL.createObjectURL(source);
      shouldRevoke = true;
    } else if (typeof source === 'string') {
      srcUrl = source;
    } else {
      return reject(new Error('Invalid image source type'));
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let { width, height } = img;

        // Downscale while preserving aspect ratio
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          if (shouldRevoke) URL.revokeObjectURL(srcUrl);
          return resolve(srcUrl);
        }

        // High quality smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Try WebP first (smallest size), fallback to JPEG
        let dataUrl = canvas.toDataURL('image/webp', quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        if (shouldRevoke) URL.revokeObjectURL(srcUrl);
        resolve(dataUrl);
      } catch {
        if (shouldRevoke) URL.revokeObjectURL(srcUrl);
        resolve(srcUrl);
      }
    };

    img.onerror = () => {
      if (shouldRevoke) URL.revokeObjectURL(srcUrl);
      resolve(srcUrl);
    };

    img.src = srcUrl;
  });
}
