// Export the canonical vector Mazle logo as an opaque App Store icon.
// Uses the Sharp installation provided by the web app's Next.js dependencies.
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const artwork = source.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#f4fbff"/>
  <svg x="86" y="118" width="852" height="852" viewBox="0 0 56 56">${artwork}</svg>
</svg>`;
const directory = new URL('../ios/Mazle/Assets.xcassets/AppIcon.appiconset/', import.meta.url);
await mkdir(directory, { recursive: true });
await sharp(Buffer.from(svg))
  .flatten({ background: '#f4fbff' })
  .png()
  .toFile(fileURLToPath(new URL('AppIcon.png', directory)));
