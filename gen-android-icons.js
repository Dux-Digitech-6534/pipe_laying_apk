// Generate the Android launcher icons + splash from the DUX mark.
//
// Writes the legacy square/round mipmaps AND the adaptive-icon layers
// (foreground = the mark with generous padding, background = the brand
// gradient), because Android 8+ crops the foreground to whatever mask the
// launcher uses and an un-padded mark loses its edges.

import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const res = join(here, 'android-shell', 'android', 'app', 'src', 'main', 'res');
const mark = join(here, 'frontend', 'src', 'assets', 'dux-mark-white.png');

const GRADIENT = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6D5EF6"/>
      <stop offset="55%" stop-color="#4F9FD8"/>
      <stop offset="100%" stop-color="#0E9C8B"/>
    </linearGradient>
  </defs>`;

function plate(size, radius) {
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${GRADIENT}` +
      `<rect width="${size}" height="${size}" rx="${radius}" fill="url(#g)"/></svg>`,
  );
}

/** Mark centred on a plate.
 *
 *  Composited at full size into a buffer and only THEN resized: sharp applies
 *  .resize() BEFORE .composite() within one pipeline, so chaining them shrinks
 *  the plate first and the overlay no longer fits. Two passes is the fix. */
async function icon(size, radius, markRatio) {
  const BIG = 1024;

  const resizedMark = await sharp(mark)
    .resize({ width: Math.round(BIG * markRatio) })
    .png()
    .toBuffer();

  const composed = await sharp(plate(BIG, Math.round(BIG * (radius / size))))
    .composite([{ input: resizedMark, gravity: 'center' }])
    .png()
    .toBuffer();

  return sharp(composed).resize(size, size).png().toBuffer();
}

// Legacy launcher icons: full-bleed plate, mark at 62%.
const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];

for (const [density, size] of DENSITIES) {
  const dir = join(res, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });

  const square = await icon(size, Math.round(size * 0.18), 0.62);
  writeFileSync(join(dir, 'ic_launcher.png'), square);
  writeFileSync(join(dir, 'ic_launcher_round.png'), await icon(size, size / 2, 0.6));

  // Adaptive foreground: the safe zone is the middle ~66% of the 108dp canvas,
  // so the mark sits at 40% of the full width and the rest is transparent.
  const fgSize = Math.round(size * 1.5);
  const fgMark = await sharp(mark)
    .resize({ width: Math.round(fgSize * 0.4) })
    .png()
    .toBuffer();
  const foreground = await sharp({
    create: {
      width: fgSize,
      height: fgSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: fgMark, gravity: 'center' }])
    .png()
    .toBuffer();
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), foreground);

  writeFileSync(
    join(dir, 'ic_launcher_background.png'),
    await sharp(plate(fgSize, 0)).png().toBuffer(),
  );

  console.log('icons', density, size);
}

// Adaptive icon descriptors.
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
for (const dir of ['mipmap-anydpi-v26']) {
  mkdirSync(join(res, dir), { recursive: true });
  writeFileSync(join(res, dir, 'ic_launcher.xml'), adaptive);
  writeFileSync(join(res, dir, 'ic_launcher_round.xml'), adaptive);
}
console.log('adaptive icon xml written');

// Splash: the mark centred on the brand gradient, portrait-ish canvas that
// CENTER_CROP can fill on any aspect ratio.
const SPLASH_W = 1440;
const SPLASH_H = 2560;
const splashMark = await sharp(mark).resize({ width: Math.round(SPLASH_W * 0.34) }).png().toBuffer();
const splash = await sharp(
  Buffer.from(
    `<svg width="${SPLASH_W}" height="${SPLASH_H}" xmlns="http://www.w3.org/2000/svg">${GRADIENT}` +
      `<rect width="${SPLASH_W}" height="${SPLASH_H}" fill="url(#g)"/></svg>`,
  ),
)
  .composite([{ input: splashMark, gravity: 'center' }])
  .png()
  .toBuffer();

for (const dir of [
  'drawable',
  'drawable-land-hdpi',
  'drawable-land-mdpi',
  'drawable-land-xhdpi',
  'drawable-land-xxhdpi',
  'drawable-land-xxxhdpi',
  'drawable-port-hdpi',
  'drawable-port-mdpi',
  'drawable-port-xhdpi',
  'drawable-port-xxhdpi',
  'drawable-port-xxxhdpi',
]) {
  mkdirSync(join(res, dir), { recursive: true });
  writeFileSync(join(res, dir, 'splash.png'), splash);
}
console.log('splash written');
