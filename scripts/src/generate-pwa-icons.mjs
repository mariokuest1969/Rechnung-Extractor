/**
 * Generates PWA icons (192x192 and 512x512) as PNG files
 * using only Node.js built-in modules (zlib + fs).
 */
import zlib from "zlib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../../artifacts/re2026/public");

// CRC-32 table
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const crc = crc32(Buffer.concat([typeBytes, data]));
  return Buffer.concat([u32be(data.length), typeBytes, data, u32be(crc)]);
}

/**
 * Draw a simple icon:
 * - Dark blue background (#1e293b)
 * - Two accent squares in teal (#0d9488) forming an "R" shape
 */
function renderPixel(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const pad = size * 0.15;
  const inner = size - pad * 2;

  // Background color
  const bg = [30, 41, 59];          // #1e293b slate-800
  const accent = [13, 148, 136];    // #0d9488 teal-600
  const light = [203, 213, 225];    // #cbd5e1 slate-300

  const rx = x - pad;
  const ry = y - pad;

  // Outer rounded-ish square border (light)
  const borderW = inner * 0.08;
  if (rx >= 0 && rx < inner && ry >= 0 && ry < inner) {
    if (rx < borderW || rx > inner - borderW || ry < borderW || ry > inner - borderW) {
      return light;
    }
    // "RE" letterform approximation using rectangles
    // Left vertical bar
    const barW = inner * 0.18;
    const barH = inner * 0.72;
    const barX = inner * 0.12;
    const barY = inner * 0.14;
    if (rx >= barX && rx < barX + barW && ry >= barY && ry < barY + barH) return accent;

    // Top horizontal bar of R
    const topH = inner * 0.16;
    const topX = barX + barW;
    const topW = inner * 0.32;
    if (rx >= topX && rx < topX + topW && ry >= barY && ry < barY + topH) return accent;

    // Middle horizontal bar of R
    const midY = barY + barH * 0.4;
    if (rx >= topX && rx < topX + topW && ry >= midY && ry < midY + topH) return accent;

    // Right side top bulge of R
    const bulgeX = topX + topW;
    const bulgeW = inner * 0.12;
    if (rx >= bulgeX && rx < bulgeX + bulgeW && ry >= barY + topH && ry < midY) return accent;

    // Diagonal leg of R (approximated as a slanted rect)
    const legStartX = barX + barW + inner * 0.12;
    const legStartY = midY + topH;
    const legEndX = topX + topW + inner * 0.1;
    const legEndY = barY + barH;
    if (ry >= legStartY && ry < legEndY) {
      const t = (ry - legStartY) / (legEndY - legStartY);
      const legX = legStartX + t * (legEndX - legStartX);
      if (rx >= legX && rx < legX + barW * 0.9) return accent;
    }
  }
  return bg;
}

function createPNG(size) {
  const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  // Raw pixel data: for each row, filter byte (0) + RGB per pixel
  const rowSize = 1 + size * 3;
  const raw = Buffer.alloc(size * rowSize);
  for (let y = 0; y < size; y++) {
    raw[y * rowSize] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b] = renderPixel(x, y, size);
      raw[y * rowSize + 1 + x * 3] = r;
      raw[y * rowSize + 1 + x * 3 + 1] = g;
      raw[y * rowSize + 1 + x * 3 + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdrData),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const outPath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, createPNG(size));
  console.log(`✓ ${outPath} (${size}×${size})`);
}
