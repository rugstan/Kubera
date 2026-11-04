import { mapServerFailure, networkFailure, type FormFailure, type MapOptions } from "./server-errors";

export type PostResult<T = unknown> = { ok: true; data: T } | { ok: false; failure: FormFailure };

/**
 * POSTs JSON and returns either the parsed body or a FormFailure with a
 * message a person can act on. Never throws.
 */
export async function postJson<T = unknown>(
  url: string,
  payload: unknown,
  opts: MapOptions & { headers?: Record<string, string>; fetchImpl?: typeof fetch } = {},
): Promise<PostResult<T>> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...opts.headers },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, failure: networkFailure(opts) };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) return { ok: false, failure: mapServerFailure(res.status, body, opts) };
  return { ok: true, data: body as T };
}
