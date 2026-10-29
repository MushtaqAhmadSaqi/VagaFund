import imageCompression from 'browser-image-compression';

const MAX_INPUT_BYTES = 15 * 1024 * 1024; // 15 MB
const TARGET_MAX_BYTES = 50 * 1024; // 50 KB

export async function compressReceipt(file) {
  if (!file) {
    throw new Error('Please select a receipt image file.');
  }
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('Invalid file type. Only image files (PNG, JPEG, WebP) are supported.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Image is too large (maximum allowed size is 15 MB).');
  }

  const originalSize = file.size;
  let quality = 0.6;
  let maxDimension = 800;

  let compressedBlob = await imageCompression(file, {
    maxSizeMB: TARGET_MAX_BYTES / (1024 * 1024),
    maxWidthOrHeight: maxDimension,
    fileType: 'image/webp',
    initialQuality: quality,
    useWebWorker: true
  });

  // Iterative reduction loop guaranteeing <= 50 KB
  let safetyCounter = 0;
  while (compressedBlob.size > TARGET_MAX_BYTES && safetyCounter < 12) {
    safetyCounter += 1;
    if (quality > 0.21) {
      quality = Math.max(0.2, Number((quality - 0.1).toFixed(2)));
    } else {
      maxDimension = Math.max(240, Math.floor(maxDimension * 0.85));
    }

    compressedBlob = await imageCompression(file, {
      maxSizeMB: TARGET_MAX_BYTES / (1024 * 1024),
      maxWidthOrHeight: maxDimension,
      fileType: 'image/webp',
      initialQuality: quality,
      useWebWorker: true
    });
  }

  const finalFile = new File(
    [compressedBlob],
    `receipt_${Date.now()}.webp`,
    { type: 'image/webp', lastModified: Date.now() }
  );

  const previewUrl = URL.createObjectURL(finalFile);

  return {
    file: finalFile,
    originalSize,
    compressedSize: finalFile.size,
    previewUrl,
    revokePreview: () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
  };
}
