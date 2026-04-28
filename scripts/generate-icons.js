/**
 * generate-icons.js
 * Genera los íconos PWA a partir de icons/icon-source.png.
 *
 * Salidas:
 *   icons/icon-192.png           — 192×192, fit:contain, bg negro
 *   icons/icon-512.png           — 512×512, fit:contain, bg negro
 *   icons/icon-512-maskable.png  — 512×512 maskable: imagen al 80% del canvas, centrada, bg negro
 *   icons/apple-touch-icon.png   — 180×180, fit:contain, bg negro
 *
 * Uso:  node scripts/generate-icons.js
 */

import sharp from 'sharp';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = resolve(__dirname, '..');
const src       = resolve(root, 'icons', 'icon-source.png');
const bg        = { r: 0, g: 0, b: 0, alpha: 1 };

const icons = [
  { out: 'icons/icon-192.png',          size: 192, maskable: false },
  { out: 'icons/icon-512.png',          size: 512, maskable: false },
  { out: 'icons/icon-512-maskable.png', size: 512, maskable: true  },
  { out: 'icons/apple-touch-icon.png',  size: 180, maskable: false },
];

for (const { out, size, maskable } of icons) {
  const outPath = resolve(root, out);

  if (maskable) {
    // Imagen al 80% del canvas, centrada, fondo negro
    const inner = Math.round(size * 0.8);
    const pad   = Math.round((size - inner) / 2);

    const resized = await sharp(src)
      .resize(inner, inner, { fit: 'contain', background: bg })
      .png()
      .toBuffer();

    await sharp({
      create: { width: size, height: size, channels: 4, background: bg },
    })
      .composite([{ input: resized, top: pad, left: pad }])
      .png()
      .toFile(outPath);
  } else {
    await sharp(src)
      .resize(size, size, { fit: 'contain', background: bg })
      .png()
      .toFile(outPath);
  }

  console.log(`✓ ${out} (${size}×${size}${maskable ? ', maskable' : ''})`);
}

console.log('Done.');
