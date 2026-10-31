import { NextResponse } from "next/server";
import type { Failure } from "./mint";

export const NO_STORE = { "cache-control": "no-store" } as const;

/** JSON error body: a human-readable `error` plus a stable machine `code`. */
export function failureResponse(f: Failure): NextResponse {
  return NextResponse.json({ error: f.message, code: f.code }, { status: f.status, headers: NO_STORE });
}
