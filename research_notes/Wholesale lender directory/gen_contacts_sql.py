"""Write a migration that fills blank lender contact details from the contact research files.

Usage (from the repo root):
  python3 "research_notes/Wholesale lender directory/gen_contacts_sql.py" \
      <new migration .sql> <research .json> [<research .json> ...]

Each research file is a JSON array of records (see research3_contacts/README.md): one per panel
lender, keyed by the lender_panel id from the directory seed, or by a "ROUTED-nn" id for the
lenders in Corin's routing table (lib/ai/lenders.ts), which the seed left off the panel.

What the migration does (decided 2026-11-14):
  * Adds the routed lenders to the panel when no lender of that name is on it yet: inactive,
    never verified, category UNKNOWN, no fee split, like every directory row.
  * Fills lender_panel main phone, general and submission inbox, website, broker page (portal_url)
    and HQ address only where the column is still empty. Nothing staff entered is overwritten, and
    contact_info_version moves on for every row it changes, so an open edit form reports a conflict
    instead of silently dropping the new values.
  * Adds up to two named contacts per lender (source lender_website or directory_import, never
    verified). A person already on file under the same name only gets blank fields filled. A new
    contact is primary only when the lender has no primary yet.
  * Seeded rows keep their seed updated_by (later seed rounds and tests recognise them by it).

Every value is checked here against the same rules as the table constraints, so the migration
applies cleanly; a value that fails is left out and reported on stderr. Idempotent: running it
twice changes nothing the second time. Never edit the generated migration once applied.
"""
import json
import re
import sys
import uuid
from urllib.parse import urlsplit

OUT, INPUTS = sys.argv[1], sys.argv[2:]
NAME = OUT.rsplit("/", 1)[-1].removesuffix(".sql")
MARKER = f"migration:{NAME}"
FOUND_ON = "2026-11-14"
NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://corincommercial.com/lender-directory")

# Lenders in lib/ai/lenders.ts LENDER_ROUTING. prefix guards against a staff-added row of the same lender.
ROUTED = {
    "ROUTED-01": dict(name="Cambridge Realty Capital", prefix="cambridge realty", programs=["HUD_232"], desks="SL-001 HUD 232 / Agency (permanent & construction) (tier A, medium confidence)", ca="Yes", site='https://www.cambridgecap.com'),
    "ROUTED-02": dict(name="Greystone", prefix="greystone", programs=["HUD_232", "HUD_MULTIFAMILY", "AGENCY", "HOTEL_CMBS", "PRIVATE_BRIDGE"], desks="SL-002 HUD 232 / Agency (permanent & construction) (tier A, medium confidence); SL-031 Healthcare bridge / bridge-to-HUD (tier A, medium confidence); HM-056 Commercial bridge / transitional (tier A, medium confidence)", ca="Yes", site='https://www.greystone.com'),
    "ROUTED-03": dict(name="Lument", prefix="lument", programs=["HUD_232", "HUD_MULTIFAMILY", "AGENCY", "PRIVATE_BRIDGE"], desks="SL-003 HUD 232 / Agency (permanent & construction) (tier A, medium confidence); SL-038 Healthcare bridge / bridge-to-HUD (tier B, medium confidence); HM-057 Commercial bridge / transitional (tier A, medium confidence)", ca="Yes", site='https://www.lument.com'),
    "ROUTED-04": dict(name="VIUM Capital", prefix="vium", programs=["SBA_504", "SBA_7A"], desks="SL-010 HUD 232 / Agency (permanent & construction) (tier B, medium confidence); SL-041 Healthcare bridge / bridge-to-HUD (tier B, low confidence)", ca="Unconfirmed", site='https://www.viumcapital.com'),
    "ROUTED-05": dict(name="TMC Financing", prefix="tmc financing", programs=["SBA_504"], desks="SL-071 SBA / small care facility (RCFE, assisted living) (tier A, medium confidence)", ca="Yes", site='https://www.tmcfinancing.com'),
    "ROUTED-06": dict(name="Harvest Small Business Finance", prefix="harvest small business", programs=["SBA_7A"], desks="SL-073 SBA / small care facility (RCFE, assisted living) (tier B, low confidence)", ca="Unconfirmed", site=None),
    "ROUTED-07": dict(name="Liberty SBF", prefix="liberty sbf", programs=["SBA_7A"], desks="SL-074 SBA / small care facility (RCFE, assisted living) (tier B, low confidence)", ca="Unconfirmed", site=None),
    "ROUTED-08": dict(name="Ready Capital", prefix="ready capital", programs=["SBA_7A", "HOTEL_CMBS", "PIP_BRIDGE", "PRIVATE_BRIDGE"], desks="HM-083 Small-balance commercial (SBC) (tier B, medium confidence); SL-076 SBA / small care facility (RCFE, assisted living) (tier B, medium confidence)", ca="Unconfirmed", site='https://readycapital.com'),
    "ROUTED-09": dict(name="Roc Capital (Roc360)", prefix="roc capital", programs=["PRIVATE_BRIDGE", "HARD_MONEY"], desks="HM-096 Investor fix & flip / bridge (wholesale) (tier A, medium confidence)", ca="Yes", site='https://roccapital.com'),
    "ROUTED-10": dict(name="Fidelis Private Fund", prefix="fidelis", programs=["PRIVATE_BRIDGE", "PIP_BRIDGE"], desks="HM-018 California private money (tier B, medium confidence)", ca="Yes", site='https://www.fidelispf.com'),
}

# Same patterns as the lender_panel / lender_contacts check constraints (20261105120000_int_lender_contacts.sql).
E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")
EMAIL = re.compile(r'^[^@\s<>",;\x00-\x1f]{1,64}@[^@\s<>",;\x00-\x1f]+\.[^@\s<>",;\x00-\x1f]+$')
HTTPS = re.compile(r'^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^\s<>"\x00-\x1f]*)?$')
PORTAL = re.compile(r'^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^\s<>"?#\x00-\x1f]*)?$')
ZIP = re.compile(r"^[0-9]{5}(-[0-9]{4})?$")
STATE = re.compile(r"^[A-Z]{2}$")
CTRL = re.compile(r"[\x00-\x1f\x7f]")
NOT_A_PERSON = re.compile(r"\b(team|desk|department|group|office|support|inquiries|lending|capital|llc|inc)\b", re.I)
problems = []


def warn(rec, msg):
    problems.append(f"{rec.get('id')} {rec.get('name')}: {msg}")


def text(v, limit):
    if not isinstance(v, str):
        return None
    v = CTRL.sub("", v).strip()
    if not v:
        return None
    return v if len(v) <= limit else v[: limit - 1].rstrip(" ,;") + "…"


KEYPAD = str.maketrans({c: d for d, letters in {"2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL", "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ"}.items() for c in letters})
EXT_RE = re.compile(r"\s*(?:x|ext\.?|extension)\s*(\d{1,6})\s*$", re.I)


def split_ext(v):
    """'(951) 780-5856 x102' -> ('(951) 780-5856', '102')."""
    if not isinstance(v, str):
        return v, None
    m = EXT_RE.search(v)
    return (v[: m.start()], m.group(1)) if m else (v, None)


def phone(v, rec, what):
    """US numbers only, as +1XXXXXXXXXX; anything else stays out (a broker confirms it)."""
    if not isinstance(v, str) or not v.strip():
        return None
    v, _ = split_ext(v)
    # Vanity numbers: 1-888-PNC-BANK -> 18887622265 (phone keypad letters).
    v = v.upper().translate(KEYPAD) if re.fullmatch(r"[\d\s().+-]*[A-Z][A-Z\s.-]*", v.upper()) else v
    digits = re.sub(r"\D", "", v)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01" or digits[3] in "01":
        warn(rec, f"{what} {v!r} is not a 10-digit US number")
        return None
    e164 = "+1" + digits
    return e164 if E164.match(e164) else None


def ext(v):
    if v is None:
        return None
    d = re.sub(r"\D", "", str(v))
    return d if 1 <= len(d) <= 6 else None


def email(v, rec, what):
    if not isinstance(v, str) or not v.strip():
        return None
    v = v.strip().removeprefix("mailto:")
    local, _, domain = v.rpartition("@")
    v = f"{local}@{domain.lower()}"
    if len(v) > 254 or not EMAIL.match(v):
        warn(rec, f"{what} {v!r} is not a valid address")
        return None
    return v


def https_url(v, rec, what, portal=False):
    if not isinstance(v, str) or not v.strip():
        return None
    v = v.strip()
    if v.startswith("http://"):
        v = "https://" + v[len("http://"):]
    if portal:
        parts = urlsplit(v)
        v = f"{parts.scheme}://{parts.netloc}{parts.path}"
    if len(v) > 2048 or not (PORTAL if portal else HTTPS).match(v):
        warn(rec, f"{what} {v!r} is not an https URL the column accepts")
        return None
    return v


def host(u):
    try:
        return urlsplit(u).hostname.lower().removeprefix("www.")
    except AttributeError:
        return None


def role_for(title):
    t = (title or "").lower()
    if "sba" in t and ("business development" in t or "bdo" in t):
        return "sba_bdo"
    if "underwrit" in t:
        return "underwriter"
    if "region" in t:
        return "regional_manager"
    if re.search(r"account executive|loan officer|originat|business development|relationship|broker|production|lending officer|sales", t):
        return "account_executive"
    return "other"


def sql(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def arr(vals):
    return "array[" + ", ".join(sql(v) for v in vals) + "]::text[]" if vals else "'{}'::text[]"


records = []
for path in INPUTS:
    records.extend(json.load(open(path)))
seen = set()
panel, contacts = [], []
for rec in records:
    rid = rec.get("id")
    if rid in seen:
        warn(rec, "duplicate record, kept the first")
        continue
    seen.add(rid)
    if rec.get("status") is None or "NOT RESEARCHED" in (rec.get("notes") or ""):  # a later round fills it
        continue
    if rec.get("confidence") == "low":  # blank beats wrong: kept in the research file, not loaded
        warn(rec, "low confidence, not loaded")
        continue
    is_routed = rid in ROUTED
    if not is_routed and not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", rid or ""):
        warn(rec, "unknown id")
        continue
    site = https_url(rec.get("website_url"), rec, "website")
    main = phone(rec.get("main_phone"), rec, "main phone")
    main_ext = ext(rec.get("main_phone_ext")) or split_ext(rec.get("main_phone"))[1]
    hq = rec.get("hq") or {}
    city, state, zipc, line1 = text(hq.get("city"), 100), (hq.get("state") or "").strip().upper() or None, (hq.get("zip") or "").strip() or None, text(hq.get("line1"), 200)
    if state and not STATE.match(state):
        state = None
    if zipc and not ZIP.match(zipc):
        warn(rec, f"zip {zipc!r} dropped")
        zipc = None
    has_addr = bool(city and state)
    row = dict(
        key=None if is_routed else rid,
        prefix=ROUTED[rid]["prefix"] + "%" if is_routed else None,
        main_phone=main,
        main_phone_ext=main_ext if main else None,
        general_email=email(rec.get("general_email"), rec, "general email"),
        submission_email=email(rec.get("submission_email"), rec, "submission email"),
        website_url=site,
        portal_url=https_url(rec.get("broker_page_url"), rec, "broker page", portal=True),
        address_line1=line1 if has_addr else None,
        city=city if has_addr else None,
        address_state=state if has_addr else None,
        postal_code=zipc if has_addr else None,
    )
    if any(v for k, v in row.items() if k not in ("key", "prefix")):
        panel.append(row)
    domain = host(site) if site else None
    for rank, c in enumerate((rec.get("contacts") or [])[:2], start=1):
        name = text(c.get("full_name"), 120)
        if not name or len(name.split()) < 2 or NOT_A_PERSON.search(name):
            if name:
                warn(rec, f"contact {name!r} does not look like a person, skipped")
            continue
        src = c.get("source_url") if isinstance(c.get("source_url"), str) else None
        title = text(c.get("title"), 120)
        note = text(f"Public source: {src or 'not recorded'} (found {FOUND_ON}). Not yet confirmed by Corin; check on first contact.", 2000)
        contacts.append(dict(
            key=None if is_routed else rid,
            prefix=ROUTED[rid]["prefix"] + "%" if is_routed else None,
            rank=rank,
            full_name=name,
            title=title,
            role=role_for(title),
            email=email(c.get("email"), rec, f"email of {name}"),
            phone=(cp := phone(c.get("phone"), rec, f"phone of {name}")),
            phone_ext=split_ext(c.get("phone"))[1] if cp else None,
            source="lender_website" if src and domain and host(src) and (host(src) == domain or host(src).endswith("." + domain)) else "directory_import",
            notes=note,
        ))

lines = [
    f"-- Lender contact details from the {FOUND_ON} contact research (research_notes/Wholesale lender directory/",
    "-- research3_contacts, generated by gen_contacts_sql.py). Fills only blank fields: nothing a broker",
    "-- entered is overwritten. Values come from lenders' own websites and press releases found by search;",
    "-- every contact stays unverified until a broker confirms it. Personal values never reach audit_log",
    "-- (the redacting audit triggers from 20261105120000_int_lender_contacts). Additive and idempotent.",
    "",
]

routed = list(ROUTED)  # always on the panel, researched or not
if routed:
    lines += [
        "-- 1. Routed lenders (lib/ai/lenders.ts) that the directory seed left off the panel. Skipped when a",
        "--    lender of that name is already on it.",
        "insert into public.lender_panel (id, name, category, programs, appetite_notes, broker_friendly, active, loan_types, updated_by)",
        "select v.id, v.name, 'UNKNOWN', v.programs, v.notes, true, false,",
        "       public.derive_lender_loan_types(v.programs, 'UNKNOWN', v.notes, '{}'::text[], '{}'::text[]), " + sql(MARKER),
        "  from (values",
    ]
    vals = []
    for rid in routed:
        r = ROUTED[rid]
        site = r["site"]
        lid = uuid.uuid5(NS, "panel/" + r["name"].lower())
        notes = " | ".join(x for x in [
            f"Already in Corin's routing table (lib/ai/lenders.ts). Added to the panel by the {FOUND_ON} contact research; inactive until a broker confirms the signed broker or fee agreement, category and fee split.",
            f"Desks: {r['desks']}",
            f"Website: {site}" if site else "",
            f"Lends in CA: {r['ca']}",
        ] if x)
        vals.append(f"    ({sql(str(lid))}::uuid, {sql(r['name'])}, {arr(r['programs'])}, {sql(notes)}, {sql(r['prefix'] + '%')})")
    lines.append(",\n".join(vals))
    lines += [
        "  ) as v (id, name, programs, notes, prefix)",
        " where not exists (select 1 from public.lender_panel l where l.id = v.id or lower(l.name) like v.prefix)",
        "on conflict (id) do nothing;",
        "",
    ]

TARGET = """target as (
  select coalesce(
           (select l.id from public.lender_panel l where l.id = v.key::uuid),
           (select l.id from public.lender_panel l where v.prefix is not null and lower(l.name) like v.prefix order by l.created_at, l.id limit 1)
         ) as lender_id, v.*
    from v
)"""

if panel:
    cols = ["key", "prefix", "main_phone", "main_phone_ext", "general_email", "submission_email", "website_url", "portal_url", "address_line1", "city", "address_state", "postal_code"]
    lines += [
        "-- 2. Lender-level contact info, blanks only. One UPDATE per lender, so one (redacting) audit row.",
        "with v (" + ", ".join(cols) + ") as (values",
        ",\n".join("  (" + ", ".join(sql(r[c]) for c in cols) + ")" for r in panel),
        "), " + TARGET,
        "update public.lender_panel l",
        "   set main_phone = coalesce(l.main_phone, t.main_phone),",
        "       main_phone_ext = case when l.main_phone is null and t.main_phone is not null then t.main_phone_ext else l.main_phone_ext end,",
        "       general_email = coalesce(l.general_email, t.general_email),",
        "       submission_email = coalesce(l.submission_email, t.submission_email),",
        "       website_url = coalesce(l.website_url, t.website_url),",
        "       portal_url = coalesce(l.portal_url, t.portal_url),",
        "       address_line1 = case when l.city is null and l.address_line1 is null and l.address_state is null and l.postal_code is null then t.address_line1 else l.address_line1 end,",
        "       city = case when l.city is null and l.address_line1 is null and l.address_state is null and l.postal_code is null then t.city else l.city end,",
        "       address_state = case when l.city is null and l.address_line1 is null and l.address_state is null and l.postal_code is null then t.address_state else l.address_state end,",
        "       postal_code = case when l.city is null and l.address_line1 is null and l.address_state is null and l.postal_code is null and l.country = 'US' then t.postal_code else l.postal_code end,",
        "       contact_info_version = l.contact_info_version + 1,",
        f"       updated_by = case when l.updated_by like 'seed:lender-directory%' then l.updated_by else {sql(MARKER)} end",
        "  from target t",
        " where l.id = t.lender_id",
        "   and ((l.main_phone is null and t.main_phone is not null)",
        "     or (l.general_email is null and t.general_email is not null)",
        "     or (l.submission_email is null and t.submission_email is not null)",
        "     or (l.website_url is null and t.website_url is not null)",
        "     or (l.portal_url is null and t.portal_url is not null)",
        "     or (l.city is null and l.address_line1 is null and l.address_state is null and l.postal_code is null and t.city is not null));",
        "",
    ]

if contacts:
    cols = ["key", "prefix", "rank", "full_name", "title", "role", "email", "phone", "phone_ext", "source", "notes"]
    values = ",\n".join("  (" + ", ".join(sql(c[k]) for k in cols) + ")" for c in contacts)
    lines += [
        "-- 3. Contacts already on file under the same name: fill their blank title, email and phone.",
        "with v (" + ", ".join(cols) + ") as (values",
        values,
        "), " + TARGET,
        "update public.lender_contacts c",
        "   set title = coalesce(c.title, t.title),",
        "       email = coalesce(c.email, t.email),",
        "       phone_direct = coalesce(c.phone_direct, t.phone),",
        "       phone_ext = case when c.phone_direct is null and t.phone is not null then t.phone_ext else c.phone_ext end,",
        f"       updated_by = {sql(MARKER)},",
        "       record_version = c.record_version + 1",
        "  from target t",
        " where c.lender_id = t.lender_id and c.status = 'active' and lower(c.full_name) = lower(t.full_name)",
        "   and ((c.title is null and t.title is not null) or (c.email is null and t.email is not null) or (c.phone_direct is null and t.phone is not null));",
        "",
        "-- 4. New contacts. The first one listed becomes primary only when the lender has none.",
        "with v (" + ", ".join(cols) + ") as (values",
        values,
        "), " + TARGET,
        "insert into public.lender_contacts (lender_id, full_name, title, role, email, phone_direct, phone_ext, is_primary, source, notes, created_by)",
        "select t.lender_id, t.full_name, t.title, t.role, t.email, t.phone, t.phone_ext,",
        "       t.rank = 1 and not exists (select 1 from public.lender_contacts p where p.lender_id = t.lender_id and p.is_primary),",
        f"       t.source, t.notes, {sql(MARKER)}",
        "  from target t",
        " where t.lender_id is not null",
        "   and not exists (select 1 from public.lender_contacts c where c.lender_id = t.lender_id and lower(c.full_name) = lower(t.full_name));",
        "",
    ]

open(OUT, "w").write("\n".join(lines))
print(f"{OUT}: {len(routed)} routed lenders, {len(panel)} lender rows, {len(contacts)} contacts", file=sys.stderr)
for p in problems:
    print("  skipped: " + p, file=sys.stderr)
