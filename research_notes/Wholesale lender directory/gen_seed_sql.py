"""Write a Supabase migration that loads the wholesale lender directory into the staff backend.

Usage (from the repo root):
  python3 "research_notes/Wholesale lender directory/gen_seed_sql.py" \
      "reports/Wholesale lender directory.xlsx" \
      supabase/migrations/20261105090000_int_lender_directory_seed.sql

What it loads (decided with the desk on 2026-11-03):
  * public.lender_panel: one row per firm (desks of the same firm grouped by the workbook's
    "Same lender, other desk" links). The row is inactive, never verified, and has category
    UNKNOWN, so the usury gate keeps applying until a broker evidences the category.
  * public.credit_boxes: one row per lender desk, source 'staff', status 'pending_review',
    linked to that firm's panel row. The matcher only uses approved boxes.
  * Lenders already in Corin's routing table (the workbook's "Existing Corin relationship" = Yes)
    are skipped, as is any firm already on the panel under the same name.

The migration is idempotent: fixed UUIDs with "on conflict do nothing", plus a name check.
Never edit the generated migration once applied; generate a new one for later changes.
"""
import re
import sys
import uuid
from collections import OrderedDict

from openpyxl import load_workbook

XLSX, OUT = sys.argv[1], sys.argv[2]
ACTOR = "seed:lender-directory-2026-11-02"
NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://corincommercial.com/lender-directory")

wb = load_workbook(XLSX, data_only=True)
ws = wb["Lenders"]
hdr = [c.value for c in ws[1]]
ix = {h: i for i, h in enumerate(hdr)}
rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r[0]]


def g(r, h):
    v = r[ix[h]]
    return "" if v is None else v


def s(r, h):
    return str(g(r, h)).strip()


# --------------------------------------------------------------- programs and asset classes
SUB_PROGRAMS = {
    "CRE construction debt fund / private": ["CONSTRUCTION", "PRIVATE_BRIDGE"],
    "CRE construction bank": ["CONSTRUCTION", "BANK_LIFE_CO"],
    "Land / horizontal development": ["CONSTRUCTION", "PRIVATE_BRIDGE"],
    "Construction mezz / pref equity / C-PACE": ["CONSTRUCTION"],
    "Investor ground-up (wholesale)": ["CONSTRUCTION", "HARD_MONEY"],
    "California private money": ["HARD_MONEY", "PRIVATE_BRIDGE"],
    "National commercial hard money": ["HARD_MONEY", "PRIVATE_BRIDGE"],
    "Commercial bridge / transitional": ["PRIVATE_BRIDGE"],
    "Small-balance commercial (SBC)": ["PRIVATE_BRIDGE"],
    "Hospitality bridge / PIP": ["PIP_BRIDGE", "PRIVATE_BRIDGE"],
    "Investor fix & flip / bridge (wholesale)": ["HARD_MONEY", "PRIVATE_BRIDGE"],
    # DSCR rental take-outs have no deal program yet; the box notes say so.
    "Investor DSCR rental take-out (wholesale)": [],
    "HUD 232 / Agency (permanent & construction)": ["HUD_232"],
    "Healthcare bridge / bridge-to-HUD": ["PRIVATE_BRIDGE"],
    "Healthcare bank / balance sheet": ["BANK_LIFE_CO"],
    "Senior housing construction": ["CONSTRUCTION"],
    "Healthcare mezz / pref equity": ["PRIVATE_BRIDGE"],
    "SBA / small care facility (RCFE, assisted living)": [],
}
PROGRAM_ORDER = ["HUD_232", "HUD_MULTIFAMILY", "SBA_7A", "SBA_504", "HOTEL_CMBS", "PIP_BRIDGE", "AGENCY",
                 "BANK_LIFE_CO", "PRIVATE_BRIDGE", "HARD_MONEY", "CONSTRUCTION"]


def programs_for(r):
    sub = s(r, "Subcategory")
    text = " ".join([s(r, "Loan programs"), s(r, "Lender")]).lower()
    out = set(SUB_PROGRAMS.get(sub, []))
    if sub.startswith("HUD 232"):
        if re.search(r"fannie|freddie|optigo|\bdus\b|agency", text):
            out.add("AGENCY")
        if re.search(r"221\(d\)\(4\)|223\(f\)[^,;]*multifamily|hud multifamily", text):
            out.add("HUD_MULTIFAMILY")
    if sub.startswith("SBA"):
        if re.search(r"\b504\b", text):
            out.add("SBA_504")
        if re.search(r"7\s*\(\s*a\s*\)|\b7a\b", text):
            out.add("SBA_7A")
        if not out:  # a private lender filed under small care facilities
            out.add("PRIVATE_BRIDGE")
    if sub != "Investor DSCR rental take-out (wholesale)":
        if re.search(r"ground[- ]?up|construction loan|vertical construction|\bconstruction\b", text) and "no ground-up" not in text:
            out.add("CONSTRUCTION")
        if re.search(r"\bpip\b", text):
            out.add("PIP_BRIDGE")
    return [p for p in PROGRAM_ORDER if p in out]


def asset_classes_for(r):
    cat = s(r, "Category")
    text = " ".join([s(r, "Property types"), s(r, "Loan programs")]).lower()
    out = set()
    if cat == "Construction":
        out.add("CONSTRUCTION")
    elif cat.startswith("Senior"):
        out.add("SENIOR_LIVING")
    else:
        out.add("COMMERCIAL")
    if re.search(r"multifamily|apartment|\b5\+|multi-family", text):
        out.add("MULTIFAMILY")
    if re.search(r"hotel|hospitality|lodging", text):
        out.add("HOSPITALITY")
    if re.search(r"senior|assisted|memory care|skilled|\bsnf\b|\bal/|\bil/|rcfe|healthcare", text):
        out.add("SENIOR_LIVING")
    if re.search(r"retail|office|industrial|mixed[- ]use|self[- ]storage|commercial", text):
        out.add("COMMERCIAL")
    if "CONSTRUCTION" in programs_for(r):
        out.add("CONSTRUCTION")
    order = ["SENIOR_LIVING", "HOSPITALITY", "MULTIFAMILY", "COMMERCIAL", "CONSTRUCTION"]
    return [a for a in order if a in out]


# --------------------------------------------------------------- parsing helpers
def cents(v):
    if v in (None, ""):
        return None
    try:
        return int(round(float(v) * 100))
    except (TypeError, ValueError):
        return None


def max_pct(text, kind):
    t = text.replace("–", "-")
    vals = []
    for m in re.finditer(r"(\d{1,3}(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:the\s+)?(?:as[- ]is\s+|total\s+|combined\s+)?" + kind + r"\b", t, re.I):
        vals.append(float(m.group(1)))
    for m in re.finditer(kind + r"\b[^%\d;|]{0,24}?(\d{1,3}(?:\.\d+)?)\s*%", t, re.I):
        vals.append(float(m.group(1)))
    vals = [v for v in vals if 0 < v <= 100]
    return max(vals) if vals else None


def rate_range(text):
    t = text.replace("–", "-").replace("—", "-")
    if re.search(r"sofr|prime|treasury|bps|spread|\+\s*\d", t, re.I):
        return None, None
    m = re.search(r"(\d{1,2}(?:\.\d+)?)\s*%?\s*(?:-|to)\s*(\d{1,2}(?:\.\d+)?)\s*%", t)
    if not m:
        return None, None
    lo, hi = float(m.group(1)), float(m.group(2))
    if not (0 <= lo <= hi <= 40):
        return None, None
    return lo, hi


def recourse(text):
    t = text.lower()
    if not t:
        return None
    non = "non-recourse" in t or "nonrecourse" in t or "non recourse" in t
    full = "full recourse" in t or t.startswith("full")
    if non and full:
        return "negotiable"
    if non:
        return "non_recourse"
    if full or t.startswith("recourse"):
        return "full"
    if "partial" in t or "limited" in t:
        return "partial"
    if "negotiable" in t or "case by case" in t or "case-by-case" in t:
        return "negotiable"
    return None


def liens(text):
    t = text.lower()
    return ["first", "second"] if ("2nd" in t or "second" in t) else ["first"]


EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def first_email(text):
    m = EMAIL.search(text or "")
    return m.group(0) if m else None


def clip(text, n):
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def base_name(name):
    return re.sub(r"\s*\(.*?\)\s*", " ", name).strip(" -–·")


# --------------------------------------------------------------- group desks into firms
ids = [s(r, "ID") for r in rows]
parent = {i: i for i in ids}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


for r in rows:
    for o in s(r, "Same lender, other desk").split(","):
        o = o.strip()
        if o in parent:
            parent[find(o)] = find(s(r, "ID"))

groups = OrderedDict()
for r in rows:
    groups.setdefault(find(s(r, "ID")), []).append(r)

skipped_existing, firms = [], []  # firms: (panel name, desk rows)
used = set()
for key, rs in groups.items():
    if any(s(r, "Existing Corin relationship") == "Yes" for r in rs):
        skipped_existing.extend(s(r, "ID") + " " + s(r, "Lender") for r in rs)
        continue
    # panel name: the shortest base name in the group, made unique
    name = min((base_name(s(r, "Lender")) for r in rs), key=len)
    if name.lower() in used:
        name = f"{name} ({s(rs[0], 'HQ') or s(rs[0], 'ID')})"
    used.add(name.lower())
    firms.append((name, rs))


def sql(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def arr(vals):
    if not vals:
        return "'{}'::text[]"
    return "array[" + ", ".join(sql(v) for v in vals) + "]::text[]"


TIER_RANK = {"A": 0, "B": 1, "C": 2}
panel_values, box_values = [], []
n_boxes = 0
for name, rs in firms:
    rs = sorted(rs, key=lambda r: (TIER_RANK.get(s(r, "Tier"), 3), s(r, "ID")))
    lead = rs[0]
    pid = uuid.uuid5(NS, "panel/" + name.lower())

    progs = [p for p in PROGRAM_ORDER if any(p in programs_for(r) for r in rs)]
    mins = [cents(g(r, "Min loan ($)")) for r in rs if cents(g(r, "Min loan ($)")) is not None]
    maxs = [cents(g(r, "Max loan ($)")) for r in rs if cents(g(r, "Max loan ($)")) is not None]
    pmin = min(mins) if mins else None
    pmax = max(maxs) if maxs else None
    if pmin is not None and pmax is not None and pmin > pmax:
        pmax = None
    asset_types = []
    for r in rs:
        for part in re.split(r"[,;]", s(r, "Property types")):
            part = clip(part, 60)
            if part and part.lower() not in (a.lower() for a in asset_types):
                asset_types.append(part)
    asset_types = asset_types[:15]
    broker_friendly = any(s(r, "Tier") == "A" or s(r, "Broker sign-up / broker page") for r in rs)
    contact = next((r for r in rs if s(r, "Public contact")), None)
    email = next((first_email(s(r, "Email")) for r in rs if first_email(s(r, "Email"))), None)
    desks = "; ".join(f"{s(r, 'ID')} {s(r, 'Subcategory')} (tier {s(r, 'Tier')}, {s(r, 'Confidence').lower()} confidence)" for r in rs)
    notes = " | ".join(x for x in [
        "From the wholesale lender directory (public-source research, 2026-11-02; values are search extracts, so verify with the lender). Inactive until a broker opens the account and verifies appetite.",
        f"Desks: {desks}",
        f"Website: {s(lead, 'Website')}" if s(lead, "Website") else "",
        f"Broker page: {s(lead, 'Broker sign-up / broker page')}" if s(lead, "Broker sign-up / broker page") else "",
        f"Phone: {clip(s(lead, 'Phone'), 160)}" if s(lead, "Phone") else "",
        f"HQ: {s(lead, 'HQ')}" if s(lead, "HQ") else "",
        f"Footprint: {clip(s(lead, 'Footprint'), 160)}" if s(lead, "Footprint") else "",
        f"Lends in CA: {s(lead, 'Lends in CA')}",
        f"Licences (unverified): {clip(s(lead, 'Licenses / approvals'), 240)}" if s(lead, "Licenses / approvals") else "",
        f"Parent / AKA: {clip(s(lead, 'Parent / also known as'), 200)}" if s(lead, "Parent / also known as") else "",
    ] if x)
    panel_values.append("  (" + ", ".join([
        sql(str(pid)) + "::uuid", sql(clip(name, 160)), "'UNKNOWN'", arr(progs),
        (sql(pmin) if pmin is not None else "null") + "::bigint", (sql(pmax) if pmax is not None else "null") + "::bigint",
        "'{}'::text[]", arr(asset_types), sql(clip(notes, 2000)), sql(broker_friendly),
        sql(clip(s(contact, "Public contact"), 120) if contact else None) + "::text", sql(email) + "::text",
    ]) + ")")

    for r in rs:
        bid = uuid.uuid5(NS, "box/" + "/".join([s(r, "Lender"), s(r, "Category"), s(r, "Subcategory")]).lower())
        ltv = max_pct(s(r, "Max leverage"), "LTV")
        ltc = max_pct(s(r, "Max leverage"), "LTC")
        rmin, rmax = rate_range(s(r, "Rate range"))
        bmin, bmax = cents(g(r, "Min loan ($)")), cents(g(r, "Max loan ($)"))
        if bmin is not None and bmax is not None and bmin > bmax:
            bmax = None
        progs_r = programs_for(r)
        prog_note = ""
        if s(r, "Subcategory") == "Investor DSCR rental take-out (wholesale)":
            prog_note = "DSCR rental take-out: no matching deal program yet, so programs are empty. "
        parts = [
            f"{prog_note}Directory {s(r, 'ID')}: tier {s(r, 'Tier')}, {s(r, 'Confidence').lower()} confidence, lends in CA: {s(r, 'Lends in CA')}. States not set (empty means nationwide): confirm the footprint before approving.",
            f"Footprint: {clip(s(r, 'Footprint'), 160)}" if s(r, "Footprint") else "",
            f"Programs (as published): {clip(s(r, 'Loan programs'), 260)}" if s(r, "Loan programs") else "",
            f"Leverage: {clip(s(r, 'Max leverage'), 140)}" if s(r, "Max leverage") else "",
            f"Rate: {clip(s(r, 'Rate range'), 120)}" if s(r, "Rate range") else "",
            f"Term: {clip(s(r, 'Term'), 100)}" if s(r, "Term") else "",
            f"Recourse: {clip(s(r, 'Recourse'), 80)}" if s(r, "Recourse") else "",
            f"Speed: {clip(s(r, 'Speed to close'), 80)}" if s(r, "Speed to close") else "",
            f"Broker program: {clip(s(r, 'Broker program (how they work with / pay brokers)'), 380)}" if s(r, "Broker program (how they work with / pay brokers)") else "",
            f"Broker page: {s(r, 'Broker sign-up / broker page')}" if s(r, "Broker sign-up / broker page") else "",
            f"Phone: {clip(s(r, 'Phone'), 120)}" if s(r, "Phone") else "",
            f"Email: {clip(s(r, 'Email'), 80)}" if s(r, "Email") else "",
            f"Contact: {clip(s(r, 'Public contact') + (', ' + s(r, 'Contact title') if s(r, 'Contact title') else ''), 200)}" if s(r, "Public contact") else "",
            f"Second check: {clip(s(r, 'Second check'), 220)}" if s(r, "Second check") else "",
            f"Fit: {clip(s(r, 'Fit for Corin / notes'), 260)}" if s(r, "Fit for Corin / notes") else "",
            f"Source: {s(r, 'Primary source')}" if s(r, "Primary source") else "",
        ]
        notes_r = clip(" | ".join(x for x in parts if x), 2000)
        label = clip(f"{s(r, 'Lender')} · {s(r, 'Subcategory')}", 160)
        box_values.append("  (" + ", ".join([
            sql(str(bid)) + "::uuid", sql(str(pid)) + "::uuid", sql(clip(name, 160)), sql(label), arr(progs_r), arr(asset_classes_for(r)),
            (sql(bmin) if bmin is not None else "null") + "::bigint", (sql(bmax) if bmax is not None else "null") + "::bigint",
            (sql(ltv) if ltv is not None else "null") + "::numeric", (sql(ltc) if ltc is not None else "null") + "::numeric",
            arr(liens(s(r, "Lien position"))), sql(recourse(s(r, "Recourse"))) + "::text",
            (sql(rmin) if rmin is not None else "null") + "::numeric", (sql(rmax) if rmax is not None else "null") + "::numeric",
            sql(notes_r),
        ]) + ")")
        n_boxes += 1

header = f"""-- Integrator data load: the wholesale lender directory (reports/Wholesale lender directory.xlsx)
-- into the staff Lender panel and Credit boxes. Generated by
-- research_notes/Wholesale lender directory/gen_seed_sql.py; do not edit by hand.
--
-- {len(firms)} firms -> public.lender_panel: inactive, never verified, category UNKNOWN (the usury
--   gate keeps applying until a broker evidences the category), no fee split. A broker reactivates a
--   lender on /deals/lenders once its account is open and its appetite is verified.
-- {n_boxes} lender desks -> public.credit_boxes: source 'staff', status 'pending_review', linked to the
--   firm's panel row. The matcher uses approved boxes only; each box's notes carry the research.
-- Skipped: {len(skipped_existing)} desks of lenders already in Corin's routing table, and any firm already on
--   the panel under the same name (its boxes attach to that existing row instead).
--
-- Values come from public-source research done from search-engine extracts on 2026-11-02 and are
-- graded for confidence in the workbook. Idempotent: fixed ids with on conflict do nothing.
-- Data only: no schema change, no funds fields.
"""

out = [header]
out.append("insert into public.lender_panel (id, name, category, programs, min_loan_cents, max_loan_cents, states, asset_types, appetite_notes, broker_friendly, contact_name, contact_email, active, updated_by)")
out.append("select v.id, v.name, v.category, v.programs, v.min_loan_cents, v.max_loan_cents, v.states, v.asset_types, v.appetite_notes, v.broker_friendly, v.contact_name, v.contact_email, false, " + sql(ACTOR))
out.append("from (values")
out.append(",\n".join(panel_values))
out.append(") as v (id, name, category, programs, min_loan_cents, max_loan_cents, states, asset_types, appetite_notes, broker_friendly, contact_name, contact_email)")
out.append("where not exists (select 1 from public.lender_panel p where lower(p.name) = lower(v.name))")
out.append("on conflict (id) do nothing;\n")
out.append("insert into public.credit_boxes (id, lender_id, source, status, label, programs, asset_classes, states, min_loan_cents, max_loan_cents, max_ltv_pct, max_ltc_pct, lien_positions, recourse, notes, rate_min_pct, rate_max_pct, updated_by)")
out.append("select v.id, coalesce(own.id, named.id), 'staff', 'pending_review', v.label, v.programs, v.asset_classes, '{}'::text[], v.min_loan_cents, v.max_loan_cents, v.max_ltv_pct, v.max_ltc_pct, v.lien_positions, v.recourse, v.notes, v.rate_min_pct, v.rate_max_pct, " + sql(ACTOR))
out.append("from (values")
out.append(",\n".join(box_values))
out.append(") as v (id, panel_id, panel_name, label, programs, asset_classes, min_loan_cents, max_loan_cents, max_ltv_pct, max_ltc_pct, lien_positions, recourse, rate_min_pct, rate_max_pct, notes)")
out.append("left join public.lender_panel own on own.id = v.panel_id")
out.append("left join lateral (select p.id from public.lender_panel p where lower(p.name) = lower(v.panel_name) order by p.created_at limit 1) named on true")
out.append("where coalesce(own.id, named.id) is not null")
out.append("on conflict (id) do nothing;\n")
open(OUT, "w").write("\n".join(out))
print(f"firms={len(firms)} boxes={n_boxes} skipped_existing_desks={len(skipped_existing)} -> {OUT}")
