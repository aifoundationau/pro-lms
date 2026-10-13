/**
 * Browser image helpers.
 * Firestore documents are limited to 1 MiB, so photos stored inline (e.g. the teacher ID image)
 * are downscaled and JPEG-compressed first.
 */

export const MAX_INLINE_IMAGE_BYTES = 600 * 1024;
const IMAGE_LOAD_TIMEOUT_MS = 20000;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src, timeoutMs = IMAGE_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      reject(new Error('The image took too long to open. Please try a JPG or PNG photo.'));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('This image could not be opened. Please upload a JPG or PNG photo (iPhone HEIC photos: export as JPG first).'));
    };
    img.src = src;
  });
}

function imageTooLargeError() {
  return new Error('The image is too large to attach. Please upload a smaller or closer photo (JPG or PNG).');
}

/** Approximate decoded size of a base64 data URL. */
export function dataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Returns a JPEG data URL no larger than `maxBytes`, shrinking dimensions/quality as needed.
 * @param {File} file image file chosen by the user
 */
export async function compressImageToDataUrl(file, { maxDimension = 1400, maxBytes = MAX_INLINE_IMAGE_BYTES } = {}) {
  if (!file || !/^image\//i.test(file.type || '')) throw new Error('Please choose an image file (JPG, PNG, HEIC exported as JPG, etc.).');
  if (file.size > 25 * 1024 * 1024) throw new Error('The image is larger than 25 MB. Please choose a smaller photo.');

  const original = await readAsDataUrl(file);
  // Without a usable canvas the original is kept only when it is already small enough.
  const originalIfSmall = () => {
    if (dataUrlBytes(original) <= maxBytes) return original;
    throw imageTooLargeError();
  };
  if (typeof document === 'undefined') return originalIfSmall();

  const img = await loadImage(original);
  let dimension = Math.min(maxDimension, Math.max(img.naturalWidth, img.naturalHeight) || maxDimension);
  for (const quality of [0.82, 0.72, 0.6, 0.5, 0.42]) {
    const scale = Math.min(1, dimension / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return originalIfSmall();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const output = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(output) <= maxBytes) return output;
    dimension = Math.round(dimension * 0.8);
  }
  throw imageTooLargeError();
}
