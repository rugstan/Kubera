// Writes ops/twenty/fields.json from lib/crm/twenty-fields.ts: the custom
// fields the site writes on Twenty opportunities (leads) and companies
// (partners). The CRM's schema script applies that file to the workspace,
// dry run first and additive only, before a release that writes a new field.
//
//   npm run twenty:fields
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fieldsManifest } from "@/lib/crm/twenty-fields";

const out = path.resolve(import.meta.dirname, "../ops/twenty/fields.json");
writeFileSync(out, `${JSON.stringify(fieldsManifest(), null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${fieldsManifest().fields.length} fields)`);
