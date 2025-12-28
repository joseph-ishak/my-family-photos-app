// src/lib/image-edit.ts
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
