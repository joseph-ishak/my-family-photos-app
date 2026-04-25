// src/lib/image-edit.ts

/**
 * Renders the crop region of an image (after optional rotation) to a new Blob.
 *
 * The function works entirely in-browser using the Canvas 2D API:
 *   1. Loads the source image from `imageSrc`.
 *   2. Rotates it onto a temporary canvas (using the bounding-box dimensions so
 *      nothing is clipped).
 *   3. Copies only the `cropPixels` rectangle to an output canvas.
 *   4. Encodes the output canvas as a Blob of the requested `mimeType`.
 *
 * @param params.imageSrc   - URL or data-URL of the source image.
 * @param params.cropPixels - Crop region in image-space coordinates (post-rotation).
 * @param params.rotation   - Clockwise rotation in degrees to apply before cropping.
 * @param params.mimeType   - Output format; defaults to `"image/jpeg"`.
 * @param params.quality    - JPEG quality 0–1; ignored for non-JPEG types. Defaults to 0.92.
 *
 * @throws {Error} If the browser does not support the Canvas API or `toBlob` fails.
 */
export async function getCroppedBlob(params: {
  imageSrc: string;
  cropPixels: { x: number; y: number; width: number; height: number };
  rotation: number;
  mimeType?: string;
  quality?: number;
}): Promise<Blob> {
  const {
    imageSrc,
    cropPixels,
    rotation,
    mimeType = "image/jpeg",
    quality = 0.92,
  } = params;

  const image = await loadImage(imageSrc);

  const tempCanvas = document.createElement("canvas");
  const tctx = tempCanvas.getContext("2d");
  if (!tctx) throw new Error("Canvas not supported");

  const iw = image.width;
  const ih = image.height;

  const radians = (rotation * Math.PI) / 180;

  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const bw = Math.abs(iw * cos) + Math.abs(ih * sin);
  const bh = Math.abs(iw * sin) + Math.abs(ih * cos);

  tempCanvas.width = Math.ceil(bw);
  tempCanvas.height = Math.ceil(bh);

  tctx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
  tctx.rotate(radians);
  tctx.drawImage(image, -iw / 2, -ih / 2);

  const outCanvas = document.createElement("canvas");
  const octx = outCanvas.getContext("2d");
  if (!octx) throw new Error("Canvas not supported");

  outCanvas.width = Math.round(cropPixels.width);
  outCanvas.height = Math.round(cropPixels.height);

  octx.drawImage(
    tempCanvas,
    Math.round(cropPixels.x),
    Math.round(cropPixels.y),
    Math.round(cropPixels.width),
    Math.round(cropPixels.height),
    0,
    0,
    Math.round(cropPixels.width),
    Math.round(cropPixels.height)
  );

  return await new Promise((resolve, reject) => {
    outCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      mimeType,
      mimeType === "image/jpeg" ? quality : undefined
    );
  });
}

/**
 * Loads an image from a URL and resolves once the browser has fully decoded it.
 * `crossOrigin = "anonymous"` is set so Canvas operations on S3-hosted images
 * do not throw security errors (requires the S3 bucket to send CORS headers).
 *
 * @throws {Error} If the image fails to load (network error, CORS, bad URL, etc.).
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
