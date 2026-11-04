// Test helper: reads the filesystem, so only tests import it.
import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * The URL segment of every top-level route folder under app/(staff)/. Nested
 * route groups ("(name)") add no segment, so their children count as top
 * level; private ("_name") and parallel ("@name") folders are not routes.
 */
export function staffRouteFolders(dir = path.join(process.cwd(), "app", "(staff)")): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_") || entry.name.startsWith("@")) continue;
    if (entry.name.startsWith("(") && entry.name.endsWith(")")) {
      out.push(...staffRouteFolders(path.join(dir, entry.name)));
      continue;
    }
    out.push(entry.name);
  }
  return out.sort();
}
