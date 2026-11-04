// Applies every migration to PGlite (with the Supabase stubs and Supabase's
// default grants) and exercises the WS-I tables as each kind of caller:
// anonymous, staff with and without MFA, admins, and portal members.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, createStubbedDb, listMigrations } from "../../scripts/test-migrations.ts";

let db: PGlite;

const IDS = {
  broker: "00000000-0000-4000-8000-0000000000b1",
  analyst: "00000000-0000-4000-8000-0000000000a1",
  admin: "00000000-0000-4000-8000-0000000000ad",
  borrower: "00000000-0000-4000-8000-0000000000c1",
  outsider: "00000000-0000-4000-8000-0000000000c2",
};

let dealA = "";
let dealB = "";
let leadA = "";

const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

async function as<T>(who: keyof typeof IDS | "anon", aal: "aal1" | "aal2", fn: () => Promise<T>): Promise<T> {
  const claims = who === "anon" ? { role: "anon" } : { sub: IDS[who], role: "authenticated", aal };
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${who === "anon" ? "anon" : "authenticated"}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

beforeAll(async () => {
  db = await createStubbedDb();
  // Supabase grants the API roles full privileges on new public tables by default;
  // each migration has to revoke what it does not want exposed.
  await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
                 alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
  await applyMigrations(db, listMigrations());

  for (const [name, id] of Object.entries(IDS)) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.toUpperCase()}@Corin.test`]);
  }
  await db.exec(`
    insert into public.user_roles (user_id, role) values
      ('${IDS.broker}', 'broker'), ('${IDS.analyst}', 'analyst'), ('${IDS.admin}', 'admin'),
      ('${IDS.borrower}', 'borrower'), ('${IDS.outsider}', 'borrower');
  `);
  leadA = (await rows<{ id: string }>(`insert into public.leads (source, contact, intake, decision, engine, latency_ms)
    values ('express', '{}', '{"loanAmount":1}', '{}', 'rules', 1) returning id`))[0]!.id;
  const leadB = (await rows<{ id: string }>(`insert into public.leads (source, contact, intake, decision, engine, latency_ms)
    values ('express', '{}', '{"loanAmount":1}', '{}', 'rules', 1) returning id`))[0]!.id;
  dealA = (await rows<{ id: string }>(`insert into public.deals (name, lead_id, owner_id) values ('Sunrise Senior Living', $1, $2) returning id`, [leadA, IDS.broker]))[0]!.id;
  dealB = (await rows<{ id: string }>(`insert into public.deals (name, lead_id) values ('Harbor Inn', $1) returning id`, [leadB]))[0]!.id;
  await db.query(`insert into public.deal_members (deal_id, user_id, member_role) values ($1, $2, 'borrower')`, [dealA, IDS.borrower]);
  await db.query(`insert into public.documents (lead_id, kind, storage_path, file_name, content_type) values ($1, 'T12', 'a/t12.pdf', 't12.pdf', 'application/pdf')`, [leadA]);
  await db.query(`insert into public.documents (lead_id, kind, storage_path, file_name, content_type) values ($1, 'T12', 'b/t12.pdf', 't12.pdf', 'application/pdf')`, [leadB]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

let keySeq = 0;
async function newApproval(over: Record<string, string> = {}) {
  keySeq += 1;
  const cols: Record<string, string> = {
    kind: "'email'",
    idempotency_key: `'email:test:${String(keySeq).padStart(6, "0")}'`,
    summary: "'Send a document request'",
    payload: `'{"to":"x@example.com"}'`,
    payload_sha256: `'${"a".repeat(64)}'`,
    requested_by: "'agent:test'",
    expires_at: "now() + interval '1 hour'",
    ...over,
  };
  return (await rows<{ id: string }>(`insert into public.approvals (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")}) returning id`))[0]!.id;
}

describe("profiles", () => {
  it("creates a lower-cased profile for each new auth user", async () => {
    const r = await rows<{ email: string }>(`select email from public.profiles where id = $1`, [IDS.broker]);
    expect(r[0]?.email).toBe("broker@corin.test");
  });

  it("requires complete, well-formed DRE license fields", async () => {
    await expect(db.query(`update public.profiles set dre_license_number = '1234' where id = $1`, [IDS.broker])).rejects.toThrow(/check/);
    await expect(db.query(`update public.profiles set dre_license_number = '01234567' where id = $1`, [IDS.broker])).rejects.toThrow(/profiles_dre_complete/);
    await db.query(
      `update public.profiles set full_name = 'Pat Broker', dre_license_number = '01234567', dre_license_type = 'broker', dre_license_expires_on = '2028-01-31', dre_license_verified_at = now() where id = $1`,
      [IDS.broker],
    );
    // A license change clears the verification stamp.
    await db.query(`update public.profiles set dre_license_expires_on = '2029-01-31' where id = $1`, [IDS.broker]);
    expect((await rows<{ v: string | null }>(`select dre_license_verified_at as v from public.profiles where id = $1`, [IDS.broker]))[0]?.v).toBeNull();
    await db.query(`update public.profiles set dre_license_verified_at = now() where id = $1`, [IDS.broker]);
  });

  it("lets people read their own profile, and staff with MFA read everyone's", async () => {
    expect(await as("borrower", "aal1", () => rows(`select id from public.profiles`))).toHaveLength(1);
    expect(await as("broker", "aal1", () => rows(`select id from public.profiles`))).toHaveLength(1);
    expect(await as("broker", "aal2", () => rows(`select id from public.profiles`))).toHaveLength(5);
  });

  it("lets people edit only their own contact fields; admins with MFA manage licenses", async () => {
    await as("analyst", "aal2", () => db.query(`update public.profiles set full_name = 'Alex Analyst' where id = $1`, [IDS.analyst]));
    await expect(
      as("analyst", "aal2", () =>
        db.query(`update public.profiles set dre_license_number = '07654321', dre_license_type = 'salesperson', dre_license_expires_on = '2028-01-01' where id = $1`, [IDS.analyst]),
      ),
    ).rejects.toThrow(/administrator/);
    await expect(as("analyst", "aal2", () => db.query(`update public.profiles set active = false where id = $1`, [IDS.analyst]))).rejects.toThrow(/administrator/);
    // Someone else's row is invisible to the update (no error, no change).
    await as("analyst", "aal2", () => db.query(`update public.profiles set full_name = 'Hacked' where id = $1`, [IDS.broker]));
    expect((await rows<{ n: string }>(`select full_name as n from public.profiles where id = $1`, [IDS.broker]))[0]?.n).toBe("Pat Broker");

    await as("admin", "aal2", () =>
      db.query(`update public.profiles set dre_license_number = '07654321', dre_license_type = 'salesperson', dre_license_expires_on = '2028-01-01' where id = $1`, [IDS.analyst]),
    );
    expect((await rows<{ n: string }>(`select dre_license_number as n from public.profiles where id = $1`, [IDS.analyst]))[0]?.n).toBe("07654321");
    // Without MFA the admin is just a user.
    await expect(as("admin", "aal1", () => db.query(`update public.profiles set active = false where id = $1`, [IDS.admin]))).rejects.toThrow(/administrator/);
    await expect(as("admin", "aal2", () => db.query(`update public.profiles set email = 'x@y.co' where id = $1`, [IDS.analyst]))).rejects.toThrow(/permission denied/);
  });
});

describe("roles", () => {
  it("lets only admins with MFA grant roles", async () => {
    await expect(as("broker", "aal2", () => db.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [IDS.broker]))).rejects.toThrow(/row-level security/);
    await expect(as("admin", "aal1", () => db.query(`insert into public.user_roles (user_id, role) values ($1, 'broker')`, [IDS.analyst]))).rejects.toThrow(/row-level security/);
    await as("admin", "aal2", () => db.query(`insert into public.user_roles (user_id, role) values ($1, 'broker')`, [IDS.analyst]));
    expect(await as("analyst", "aal1", () => rows<{ role: string }>(`select role from public.user_roles order by role`))).toEqual([{ role: "analyst" }, { role: "broker" }]);
    await as("admin", "aal2", () => db.query(`delete from public.user_roles where user_id = $1 and role = 'broker'`, [IDS.analyst]));
  });

  it("drops a deactivated profile's roles from every access check", async () => {
    await db.query(`update public.profiles set active = false where id = $1`, [IDS.analyst]);
    expect(await as("analyst", "aal2", () => rows(`select id from public.deals`))).toHaveLength(0);
    await db.query(`update public.profiles set active = true where id = $1`, [IDS.analyst]);
    expect(await as("analyst", "aal2", () => rows(`select id from public.deals`))).toHaveLength(2);
  });
});

describe("deals and documents", () => {
  it("hides everything from anonymous callers", async () => {
    for (const table of ["deals", "approvals", "profiles", "user_roles", "deal_members", "staff_audit_events", "approval_templates", "documents"]) {
      await expect(as("anon", "aal1", () => rows(`select * from public.${table}`)), table).rejects.toThrow(/permission denied/);
    }
  });

  it("requires MFA for staff to read the pipeline", async () => {
    expect(await as("broker", "aal1", () => rows(`select id from public.deals`))).toHaveLength(0);
    expect(await as("analyst", "aal2", () => rows(`select id from public.deals`))).toHaveLength(2);
    expect(await as("broker", "aal2", () => rows(`select id from public.documents`))).toHaveLength(2);
  });

  it("shows portal members only their own deals and those deals' documents", async () => {
    const mine = await as("borrower", "aal1", () => rows<{ id: string }>(`select id from public.deals`));
    expect(mine.map((d) => d.id)).toEqual([dealA]);
    const docs = await as("borrower", "aal1", () => rows<{ lead_id: string }>(`select lead_id from public.documents`));
    expect(docs.map((d) => d.lead_id)).toEqual([leadA]);
    expect(await as("outsider", "aal1", () => rows(`select id from public.deals`))).toHaveLength(0);
    expect(await as("outsider", "aal1", () => rows(`select * from public.documents`))).toHaveLength(0);
    // Revoked membership ends access.
    await db.query(`update public.deal_members set revoked_at = now() where deal_id = $1 and user_id = $2`, [dealA, IDS.borrower]);
    expect(await as("borrower", "aal1", () => rows(`select id from public.deals`))).toHaveLength(0);
    await db.query(`update public.deal_members set revoked_at = null where deal_id = $1 and user_id = $2`, [dealA, IDS.borrower]);
  });

  it("never lets the API roles write deals or memberships (server-only, past the MLDS/OFAC/stage gates)", async () => {
    // Even a broker or admin with an MFA session cannot PATCH /rest/v1/deals:
    // stage, status and every other field change only through the server.
    for (const who of ["broker", "admin", "analyst"] as const) {
      await expect(as(who, "aal2", () => db.query(`update public.deals set stage = 'closing' where id = $1`, [dealB])), who).rejects.toThrow(/permission denied/);
      await expect(as(who, "aal2", () => db.query(`update public.deals set status = 'active' where id = $1`, [dealA])), who).rejects.toThrow(/permission denied/);
      await expect(as(who, "aal2", () => db.query(`insert into public.deals (name) values ('x')`)), who).rejects.toThrow(/permission denied/);
      await expect(as(who, "aal2", () => db.query(`delete from public.deals where id = $1`, [dealB])), who).rejects.toThrow(/permission denied/);
      await expect(
        as(who, "aal2", () => db.query(`insert into public.deal_members (deal_id, user_id, member_role) values ($1, $2, 'borrower')`, [dealB, IDS.outsider])),
        who,
      ).rejects.toThrow(/permission denied/);
      await expect(as(who, "aal2", () => db.query(`update public.deal_members set revoked_at = now() where deal_id = $1`, [dealA])), who).rejects.toThrow(/permission denied/);
    }
    await expect(as("borrower", "aal1", () => db.query(`update public.deals set stage = 'closing' where id = $1`, [dealA]))).rejects.toThrow(/permission denied/);
    expect((await rows<{ stage: string }>(`select stage from public.deals where id = $1`, [dealB]))[0]?.stage).toBe("intake");
    expect((await rows<{ stage: string }>(`select stage from public.deals where id = $1`, [dealA]))[0]?.stage).toBe("intake");
    expect(await rows(`select 1 from public.deal_members where deal_id = $1`, [dealB])).toHaveLength(0);
    // The write policies are gone; reads are unchanged.
    const policies = await rows<{ policyname: string }>(
      `select policyname from pg_policies where schemaname = 'public' and tablename in ('deals', 'deal_members') order by policyname`,
    );
    expect(policies.map((p) => p.policyname)).toEqual(["deal_members_read_own", "deal_members_read_staff", "deals_read_member", "deals_read_staff"]);
    expect(await as("broker", "aal2", () => rows(`select id from public.deals`))).toHaveLength(2);
  });

  it("models Corin as broker only and links disclosures to deals", async () => {
    await expect(db.query(`insert into public.deals (name, corin_role) values ('x', 'lender')`)).rejects.toThrow(/deals_corin_is_broker/);
    // Stage keys come from the WS-T stage templates; the integration migration only checks their shape.
    await expect(db.query(`insert into public.deals (name, stage) values ('x', 'Not a stage')`)).rejects.toThrow(/deals_stage_key/);
    const fk = await rows<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint where conname in ('disclosures_deal_fk', 'broker_of_record_deal_fk') order by conname`,
    );
    expect(fk).toEqual([
      { conname: "broker_of_record_deal_fk", convalidated: true },
      { conname: "disclosures_deal_fk", convalidated: true },
    ]);
    await expect(
      db.query(`insert into public.disclosures (kind, status, deal_id) values ('MLDS_RE882', 'required', '00000000-0000-4000-8000-00000000dead')`),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("approvals", () => {
  beforeEach(async () => {
    await db.exec("reset role");
  });

  it("is readable by staff with MFA only and never writable through the API roles", async () => {
    const id = await newApproval();
    expect(await as("analyst", "aal2", () => rows(`select id from public.approvals where id = $1`, [id]))).toHaveLength(1);
    expect(await as("broker", "aal1", () => rows(`select id from public.approvals`))).toHaveLength(0);
    expect(await as("borrower", "aal1", () => rows(`select id from public.approvals`))).toHaveLength(0);
    await expect(as("broker", "aal2", () => db.query(`update public.approvals set status = 'approved' where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(as("broker", "aal2", () => db.query(`delete from public.approvals where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(
      as("broker", "aal2", () =>
        db.query(`insert into public.approvals (kind, idempotency_key, summary, payload_sha256, requested_by, expires_at) values ('email', 'email:forged:01', 'x', '${"a".repeat(64)}', 'me', now() + interval '1 hour')`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("enforces one row per idempotency key", async () => {
    await newApproval({ idempotency_key: "'email:dup:000001'" });
    await expect(newApproval({ idempotency_key: "'email:dup:000001'" })).rejects.toThrow(/approvals_idempotency_unique/);
  });

  it("requires a licensed approver (or a pre-approved template) for approval", async () => {
    const id = await newApproval();
    await expect(db.query(`update public.approvals set status = 'approved', decided_at = now(), decided_by = $1 where id = $2`, [IDS.broker, id])).rejects.toThrow(
      /approvals_approved_by/,
    );
    await db.query(`update public.approvals set status = 'approved', decided_at = now(), decided_by = $1, decided_by_dre = '01234567' where id = $2`, [IDS.broker, id]);
    await expect(newApproval({ status: "'approved'", decided_at: "now()", auto_approved: "true" })).rejects.toThrow(/approvals_approved_by/);
  });

  it("keeps decisions final and request fields immutable", async () => {
    const id = await newApproval();
    await expect(db.query(`update public.approvals set payload = '{"to":"other@example.com"}' where id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(db.query(`update public.approvals set expires_at = now() + interval '9 days' where id = $1`, [id])).rejects.toThrow(/immutable/);
    await db.query(`update public.approvals set status = 'rejected', decided_at = now(), decided_by = $1, decision_reason = 'No' where id = $2`, [IDS.broker, id]);
    await expect(
      db.query(`update public.approvals set status = 'approved', decided_by_dre = '01234567', decision_reason = null where id = $1`, [id]),
    ).rejects.toThrow(/already rejected/);
    await expect(db.query(`update public.approvals set decision_reason = 'Changed my mind' where id = $1`, [id])).rejects.toThrow(/already rejected/);
    await expect(db.query(`delete from public.approvals where id = $1`, [id])).rejects.toThrow(/cannot be deleted/);
  });

  it("never approves after expiry and expires only once due", async () => {
    const due = await newApproval({ created_at: "now() - interval '2 hours'", expires_at: "now() - interval '1 hour'" });
    await expect(
      db.query(`update public.approvals set status = 'approved', decided_at = now(), decided_by = $1, decided_by_dre = '01234567' where id = $2`, [IDS.broker, due]),
    ).rejects.toThrow(/expired at/);
    const notDue = await newApproval();
    await expect(db.query(`update public.approvals set status = 'expired', decided_at = now() where id = $1`, [notDue])).rejects.toThrow(/not reached its expiry/);

    const swept = await rows<{ id: string; status: string }>(`select id, status from public.expire_due_approvals()`);
    expect(swept.map((r) => r.id)).toContain(due);
    expect(swept.map((r) => r.id)).not.toContain(notDue);
    expect((await rows<{ status: string }>(`select status from public.approvals where id = $1`, [due]))[0]?.status).toBe("expired");
    await expect(as("broker", "aal2", () => rows(`select * from public.expire_due_approvals()`))).rejects.toThrow(/permission denied/);
  });

  it("records execution once, only for approved rows", async () => {
    const pending = await newApproval();
    await expect(db.query(`update public.approvals set executed_at = now() where id = $1`, [pending])).rejects.toThrow(/cannot execute|approvals_executed_only_approved/);
    const id = await newApproval();
    await db.query(`update public.approvals set status = 'approved', decided_at = now(), decided_by = $1, decided_by_dre = '01234567' where id = $2`, [IDS.broker, id]);
    await expect(db.query(`update public.approvals set execution_ref = 'msg_0' where id = $1`, [id])).rejects.toThrow(/no execution/);
    await db.query(`update public.approvals set executed_at = now() where id = $1`, [id]);
    await db.query(`update public.approvals set execution_ref = 'msg_1' where id = $1`, [id]);
    await expect(db.query(`update public.approvals set execution_ref = 'msg_2' where id = $1`, [id])).rejects.toThrow(/already executed/);
    await expect(db.query(`update public.approvals set executed_at = now() + interval '1 minute' where id = $1`, [id])).rejects.toThrow(/already executed/);
    // The conditional claim the store uses matches nothing the second time.
    const again = await rows(`update public.approvals set executed_at = now() where id = $1 and status = 'approved' and executed_at is null returning id`, [id]);
    expect(again).toHaveLength(0);
  });
});

describe("staff audit trail", () => {
  it("is append-only and readable by admins with MFA", async () => {
    await db.query(`insert into public.staff_audit_events (actor_id, actor_label, action, target_type, target_id) values ($1, 'Pat Broker', 'document.view', 'document', 'd1')`, [IDS.broker]);
    await expect(db.query(`update public.staff_audit_events set action = 'auth.sign_in'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.staff_audit_events`)).rejects.toThrow(/append-only/);
    await expect(db.query(`insert into public.staff_audit_events (actor_label, action) values ('x', 'Not An Action')`)).rejects.toThrow(/check/);
    expect(await as("admin", "aal2", () => rows(`select id from public.staff_audit_events`))).toHaveLength(1);
    expect(await as("broker", "aal2", () => rows(`select id from public.staff_audit_events`))).toHaveLength(0);
    await expect(as("admin", "aal2", () => db.query(`insert into public.staff_audit_events (actor_label, action) values ('x', 'auth.sign_in')`))).rejects.toThrow(/permission denied/);
  });

  it("keeps audit rows when a profile is deleted (actor is nulled)", async () => {
    await db.query(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000ee', 'temp@corin.test')`);
    await db.query(`insert into public.staff_audit_events (actor_id, actor_label, action) values ('00000000-0000-4000-8000-0000000000ee', 'Temp', 'auth.sign_in')`);
    await db.query(`delete from auth.users where id = '00000000-0000-4000-8000-0000000000ee'`);
    const r = await rows<{ actor_id: string | null }>(`select actor_id from public.staff_audit_events where actor_label = 'Temp'`);
    expect(r).toEqual([{ actor_id: null }]);
  });
});
