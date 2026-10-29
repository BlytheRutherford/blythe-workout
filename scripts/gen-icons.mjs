// Generates PWA icons: the red sun on ink, with a bone "B". Uses sharp (bundled with Next).
import sharp from "sharp";
import { mkdirSync } from "node:fs";

mkdirSync("public/icons", { recursive: true });

function svg(size, pad) {
  const s = size;
  const r = s * (0.36 - pad * 0.5);
  const cx = s / 2;
  const cy = s * 0.5;
  const fs = Math.round(s * (0.5 - pad));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="sky" cx="50%" cy="0%" r="90%">
      <stop offset="0" stop-color="#701C1A"/>
      <stop offset="1" stop-color="#070709"/>
    </radialGradient>
    <radialGradient id="sun" cx="50%" cy="40%" r="60%">
      <stop offset="0" stop-color="#F42C1D"/>
      <stop offset="1" stop-color="#AE1918"/>
    </radialGradient>
  </defs>
  <rect width="${s}" height="${s}" fill="url(#sky)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#sun)"/>
  <text x="50%" y="${cy + fs * 0.35}" text-anchor="middle"
    font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="700" font-size="${fs}" fill="#070709">B</text>
</svg>`;
}

for (const [name, size, pad] of [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["icon-maskable-512.png", 512, 0.1],
  ["apple-touch-icon.png", 180, 0],
]) {
  await sharp(Buffer.from(svg(size, pad))).png().toFile(`public/icons/${name}`);
  console.log("wrote", name);
}
