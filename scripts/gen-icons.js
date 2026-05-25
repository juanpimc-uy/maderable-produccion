// scripts/gen-icons.js — Genera iconos PWA para tercerizados, recepciones, kitting
// Usa sharp (ya en devDependencies)
import sharp from 'sharp';
import { mkdirSync } from 'fs';

const ICONS_DIR = new URL('../icons/', import.meta.url).pathname;
mkdirSync(ICONS_DIR, { recursive: true });

const apps = [
  { name: 'tercerizados', letter: 'T' },
  { name: 'recepciones',  letter: 'R' },
  { name: 'kitting',      letter: 'K' },
];

const sizes = [192, 512];

for (const app of apps) {
  for (const size of sizes) {
    const fontSize = Math.round(size * 0.55);
    const yOffset = Math.round(size * 0.42);
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="#0f0f0f"/>
      <text x="50%" y="${yOffset}" dominant-baseline="central" text-anchor="middle"
        font-family="monospace" font-size="${fontSize}" font-weight="700" fill="#FFD600">
        ${app.letter}
      </text>
      <text x="50%" y="${Math.round(size * 0.78)}" text-anchor="middle"
        font-family="monospace" font-size="${Math.round(size * 0.07)}" fill="#888">
        MBLE
      </text>
    </svg>`;

    const filename = `icon-${app.name}-${size}.png`;
    await sharp(Buffer.from(svg)).png().toFile(`${ICONS_DIR}${filename}`);
    console.log(`Generated ${filename}`);
  }
}
console.log('Done.');
