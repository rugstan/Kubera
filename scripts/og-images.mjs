// Share images (og:image / twitter:image) for pages that have their own photo.
//
//   node scripts/og-images.mjs
//
// Crops every photo in assets/images/ to 1200x630 (the size Facebook, LinkedIn,
// Slack and X render without letterboxing) and writes it as a baseline JPEG to
// public/og/<name>.jpg, which some link-preview crawlers need (not all of them
// read WebP). `ogImageFor()` in lib/seo/og.ts points at these files, and
// lib/seo/og.test.ts fails when a page's photo has no share image. Re-run after
// adding or replacing a photo and commit the output.
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "assets/images");
const out = path.join(root, "public/og");
mkdirSync(out, { recursive: true });

for (const file of readdirSync(src).filter((f) => f.endsWith(".webp")).sort()) {
  const name = file.replace(/\.webp$/, "");
  const info = await sharp(path.join(src, file))
    .resize(1200, 630, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(path.join(out, `${name}.jpg`));
  console.log(`${name}.jpg ${info.width}x${info.height} ${Math.round(info.size / 1024)} KB`);
}
