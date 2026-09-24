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

/** Formats stock tools export that browsers can't rasterize on canvas. */
const UNDECODABLE_RE = /\.(heic|heif|hif|tiff?|psd|cr2|cr3|nef|arw|dng|raw|avifs)$/i;

function friendlyDecodeError(file: File, e: unknown): string {
  const name = file.name.toLowerCase();
  if (/\.heic$|\.heif$|\.hif$/.test(name) || file.type === "image/heic" || file.type === "image/heif")
    return "HEIC (iPhone) photos can't be opened by this browser — convert to JPEG first";
  if (UNDECODABLE_RE.test(name) || file.type === "image/tiff")
    return "This image format can't be previewed in a browser — export it as JPEG, PNG, WebP or SVG";
  const reason = e instanceof Error ? e.message : String(e);
  return `Couldn't decode this image (${reason || "unsupported format"})`;
}

/** Reads an SVG's intrinsic size from its markup. Browsers report naturalWidth = 0 for
 *  SVGs that only carry a viewBox (or use percentages), which breaks canvas rendering. */
async function svgIntrinsicSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const head = await file.slice(0, 262_144).text();
    const tag = head.match(/<svg\b[^>]*>/i)?.[0];
    if (!tag) return null;
    const attr = (name: string) => {
      const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
      return m ? (m[1] ?? m[2] ?? "").trim() : "";
    };
    // Percentages have no absolute meaning without a container — treat as unknown.
    const num = (v: string) => {
      if (!v || v.endsWith("%")) return 0;
      const n = parseFloat(v);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const w = num(attr("width"));
    const h = num(attr("height"));
    if (w && h) return { width: w, height: h };
    const vb = attr("viewBox").split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
    return null;
  } catch {
    return null;
  }
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
  let svgSize: { width: number; height: number } | null = null;
  if (isSvg) svgSize = await svgIntrinsicSize(file);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  // Give SVGs without intrinsic dimensions a concrete raster size before drawing.
  if (isSvg && svgSize) {
    img.width = svgSize.width;
    img.height = svgSize.height;
  }
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error(friendlyDecodeError(file, e));
  }
  let w = img.naturalWidth || 0;
  let h = img.naturalHeight || 0;
  if (isSvg) {
    if ((!w || !h) && svgSize) {
      w = svgSize.width;
      h = svgSize.height;
    }
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
  try {
    ctx.drawImage(d.source, 0, 0, w, h);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return Promise.reject(
      new Error(
        d.width && d.height
          ? `This image couldn't be drawn to canvas (${reason}) — try re-exporting it as JPEG or PNG`
          : "This image reports no pixel dimensions (common for SVGs without width/height or viewBox) — add a viewBox or export a JPEG preview",
      ),
    );
  }
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
