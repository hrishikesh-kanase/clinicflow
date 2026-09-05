// Best-effort dominant-color extraction from an uploaded branding logo.
//
// Used to auto-suggest an accent color when an admin uploads a new logo
// (see routes/branding.js). This is intentionally simple: it downsamples
// the image, buckets similar colors together, ignores near-white/near-black/
// transparent pixels (common logo backgrounds and text), and returns the
// most frequent bucket as a hex color. Admins can always override the
// result manually from Settings — this never needs to be perfect.
const sharp = require('sharp');

const QUANTIZE_STEP = 24; // round each RGB channel to buckets of this size
const WHITE_THRESHOLD = 235; // skip near-white pixels (typical logo background)
const BLACK_THRESHOLD = 20; // skip near-black pixels (typical logo text/outline)
const ALPHA_THRESHOLD = 128; // skip mostly-transparent pixels

function toHex(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

async function extractDominantColor(filePath) {
  try {
    const { data, info } = await sharp(filePath, { density: 300 }) // helps rasterize SVGs at a usable resolution
      .resize(48, 48, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const buckets = new Map();
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < ALPHA_THRESHOLD) continue;
      if (r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD) continue;
      if (r < BLACK_THRESHOLD && g < BLACK_THRESHOLD && b < BLACK_THRESHOLD) continue;

      const key = [
        Math.round(r / QUANTIZE_STEP) * QUANTIZE_STEP,
        Math.round(g / QUANTIZE_STEP) * QUANTIZE_STEP,
        Math.round(b / QUANTIZE_STEP) * QUANTIZE_STEP,
      ].join(',');
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }

    if (buckets.size === 0) return null; // e.g. a purely black/white/transparent logo

    let bestKey = null, bestCount = -1;
    for (const [key, count] of buckets) {
      if (count > bestCount) { bestCount = count; bestKey = key; }
    }
    const [r, g, b] = bestKey.split(',').map(Number);
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  } catch (e) {
    return null; // any decoding failure just means "no auto-suggestion" — never blocks the upload
  }
}

module.exports = { extractDominantColor };

