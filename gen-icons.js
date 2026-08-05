// Generate the app icons: the white DUX mark centred on the iris→cyan brand
// gradient. Outputs into frontend/public so Vite copies them into the bundle.
//
// NOTE sharp applies .resize() BEFORE .composite(), so the mark is composited at
// full canvas size into a buffer first and only then resized — compositing after
// a resize silently scales the overlay wrong.

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'frontend', 'public');
const mark = join(here, 'frontend', 'src', 'assets', 'dux-mark-white.png');

mkdirSync(out, { recursive: true });

const SIZE = 1024;

function gradientSvg(size, radius) {
  return Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#6D5EF6"/>
          <stop offset="55%" stop-color="#4F9FD8"/>
          <stop offset="100%" stop-color="#0E9C8B"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/>
    </svg>
  `);
}

/**
 * @param {number} markWidthRatio how wide the mark sits on the canvas
 * @param {number} radius corner radius of the plate
 */
async function build(markWidthRatio, radius) {
  const markWidth = Math.round(SIZE * markWidthRatio);
  const resizedMark = await sharp(mark).resize({ width: markWidth }).png().toBuffer();

  return sharp(gradientSvg(SIZE, radius))
    .composite([{ input: resizedMark, gravity: 'center' }])
    .png()
    .toBuffer();
}

// Standard icon: rounded plate, mark at 62% width.
const standard = await build(0.62, 200);
// Maskable: Android crops to a circle inscribed in the safe zone, so the mark
// must sit inside the middle ~66% and the plate must be a full-bleed square.
const maskable = await build(0.46, 0);

for (const [size, name] of [
  [192, 'icon-192.png'],
  [512, 'icon-512.png'],
]) {
  await sharp(standard).resize(size, size).png().toFile(join(out, name));
  console.log('wrote', name);
}

await sharp(maskable).resize(512, 512).png().toFile(join(out, 'icon-maskable-512.png'));
console.log('wrote icon-maskable-512.png');

// Full-size source for the Android launcher icon pipeline.
await sharp(standard).png().toFile(join(out, 'icon-1024.png'));
console.log('wrote icon-1024.png');
