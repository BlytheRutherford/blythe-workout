// Generates PWA icons: butter "B" wordmark on black. Uses sharp (bundled with Next).
import sharp from "sharp";
import { mkdirSync } from "node:fs";

mkdirSync("public/icons", { recursive: true });

function svg(size) {
  const fs = Math.round(size * 0.62);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0A0A0A"/>
  <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle"
    font-family="Georgia, 'Times New Roman', serif" font-size="${fs}" fill="#F3E5AB">B</text>
</svg>`;
}

for (const [name, size] of [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["icon-maskable-512.png", 512, 0.1],
  ["apple-touch-icon.png", 180, 0],
]) {
  await sharp(Buffer.from(svg(size))).png().toFile(`public/icons/${name}`);
  console.log("wrote", name);
}
