import { defineConfig, type Plugin } from "vitest/config";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Width and height from a WebP (VP8, VP8L, VP8X) or PNG header, without an image library. */
function imageSize(buf: Buffer): { width: number; height: number } {
  if (buf.toString("ascii", 1, 4) === "PNG") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") throw new Error("not a WebP or PNG file");
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  throw new Error(`unknown WebP chunk ${chunk}`);
}

/**
 * Static image imports the way Next.js gives them to `next/image`
 * ({ src, width, height, blurDataURL }), so components that render
 * `content/images.ts` work in tests. Vite alone would hand back a bare URL.
 */
function nextStaticImages(): Plugin {
  return {
    name: "next-static-images",
    enforce: "pre",
    load(id) {
      const file = id.split("?")[0]!;
      if (!/\.(webp|png)$/i.test(file)) return null;
      const { width, height } = imageSize(readFileSync(file));
      const src = `/_next/static/media/${path.basename(file)}`;
      const image = { src, width, height, blurDataURL: "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", blurWidth: 8, blurHeight: 8 };
      return `export default ${JSON.stringify(image)};`;
    },
  };
}

export default defineConfig({
  plugins: [nextStaticImages()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".claude/**"],
    // Many suites `await import()` route handlers or server modules inside a
    // test body; the first import transforms a large module graph (workflows,
    // agents, Inngest) and can take several seconds on a loaded machine or a
    // 2-core CI runner. The 5 s default flakes there, so allow headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
