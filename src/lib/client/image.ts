"use client";

// Downscales in the browser so uploads stay small and vision calls stay cheap:
// a 1280px analysis JPEG (plenty for background/template classification) + a 320px thumbnail.

export interface ProcessedImage {
  analysis: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

const ANALYSIS_MAX = 1280;
const THUMB_MAX = 320;

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

async function decode(file: File): Promise<Decoded> {
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (!isSvg && typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close() };
    } catch {
      /* fall back to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("Unsupported or corrupt image");
  }
  let w = img.naturalWidth || 0;
  let h = img.naturalHeight || 0;
  if (isSvg) {
    if (!w || !h) {
      w = 2000;
      h = 2000;
    }
    const s = 2000 / Math.max(w, h);
    if (s > 1) {
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
  }
  return { source: img, width: w, height: h, cleanup: () => URL.revokeObjectURL(url) };
}

function render(d: Decoded, max: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(d.width, d.height));
  const w = Math.max(1, Math.round(d.width * scale));
  const h = Math.max(1, Math.round(d.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas unavailable"));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(d.source, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG encoding failed"))), "image/jpeg", quality),
  );
}

export async function processImage(file: File): Promise<ProcessedImage> {
  const d = await decode(file);
  try {
    if (!d.width || !d.height) throw new Error("Image has no dimensions");
    const analysis = await render(d, ANALYSIS_MAX, 0.86);
    const thumb = await render(d, THUMB_MAX, 0.78);
    return { analysis, thumb, width: d.width, height: d.height };
  } finally {
    d.cleanup();
  }
}
