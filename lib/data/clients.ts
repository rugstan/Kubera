import { AttomClient } from "./attom";
import { FemaNfhlClient } from "./fema";
import { logOnce } from "./http";
import { OpenCorporatesClient } from "./opencorporates";
import { RegridClient } from "./regrid";
import { HelloDataClient, RentometerClient } from "./rent";
import type { DataClients } from "./types";

// Env-gated client factory. A missing key logs once and leaves that source
// null; getPropertyFacts then reports it as `not_configured` instead of failing.

type Env = Record<string, string | undefined>;

function key(env: Env, name: string, purpose: string): string | null {
  const v = env[name]?.trim();
  if (v) return v;
  logOnce(`data:${name}`, `data: ${name} not set; ${purpose} is disabled`);
  return null;
}

export function buildDataClients(env: Env = process.env): DataClients {
  const regrid = key(env, "REGRID_API_TOKEN", "Regrid parcel lookups");
  const oc = key(env, "OPENCORPORATES_API_TOKEN", "OpenCorporates entity status");
  const attom = key(env, "ATTOM_API_KEY", "ATTOM deed, mortgage and sales comps");
  const hello = key(env, "HELLODATA_API_KEY", "HelloData rent comps");
  const rentometer = key(env, "RENTOMETER_API_KEY", "Rentometer rent estimates");
  return {
    regrid: regrid ? new RegridClient(regrid) : null,
    opencorporates: oc ? new OpenCorporatesClient(oc) : null,
    // FEMA's NFHL service is public and needs no key; FEMA_NFHL_ENABLED=false turns it off.
    fema: env.FEMA_NFHL_ENABLED?.trim().toLowerCase() === "false" ? null : new FemaNfhlClient(),
    attom: attom ? new AttomClient(attom) : null,
    hellodata: hello ? new HelloDataClient(hello, undefined, env.HELLODATA_BASE_URL?.trim() || undefined) : null,
    rentometer: rentometer ? new RentometerClient(rentometer) : null,
  };
}

let instance: DataClients | undefined;

/** The process-wide clients, built from env on first use. */
export function dataClients(): DataClients {
  instance ??= buildDataClients();
  return instance;
}

/** Test hook: inject clients (undefined re-reads env on the next call). */
export function setDataClients(clients: DataClients | undefined): void {
  instance = clients;
}

export const NO_CLIENTS: DataClients = { regrid: null, opencorporates: null, fema: null, attom: null, hellodata: null, rentometer: null };
