"""Build the Corin wholesale lender directory workbook from the research JSON files.

Usage (from the repo root):
  python3 "research_notes/Wholesale lender directory/build_workbook.py" \
      "research_notes/Wholesale lender directory" "reports/Wholesale lender directory.xlsx"

Reads research/lenders_*.json, second_check/verify_out_*.json and overrides.json under the
given folder. Recalculate the formulas afterwards (LibreOffice or opening in Excel) so the
Dashboard shows cached values to viewers that do not recalculate.
"""
import json
import re
import sys
from collections import OrderedDict
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

RESEARCH_DIR = Path(sys.argv[1])
OUT = Path(sys.argv[2])
AS_OF = "2026-11-02"

FONT = "Arial"
NAVY = "1F3864"
TEAL = "DDEBF7"
YELLOW = "FFF2CC"
GREY = "F2F2F2"
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

CATEGORY_ORDER = ["Construction", "Hard Money / Bridge", "Senior Living / Healthcare", "Multifamily", "Hospitality",
                  "Institutional / Capital Markets", "Bank / SBA"]
CATEGORY_PREFIX = {"Construction": "CN", "Hard Money / Bridge": "HM", "Senior Living / Healthcare": "SL", "Multifamily": "MF",
                   "Hospitality": "HO", "Institutional / Capital Markets": "IN", "Bank / SBA": "BK"}
TIER_ORDER = {"A": 0, "B": 1, "C": 2}

STATUSES = [
    "Not started",
    "Existing relationship",
    "Researching",
    "Contacted",
    "In conversation",
    "Application submitted",
    "Approved - account open",
    "Declined / not a fit",
    "On hold",
]
AGREEMENT = ["Yes", "No", "Pending", "N/A"]

# Lenders Corin already routes to (lib/ai/lenders.ts). Matched on normalised name.
EXISTING = {
    "vium capital": "Vium Capital",
    "greystone": "Greystone",
    "cambridge realty capital": "Cambridge Realty Capital",
    "lument": "Lument",
    "liberty sbf": "Liberty SBF",
    "harvest sbf": "Harvest SBF",
    "harvest small business finance": "Harvest SBF",
    "ready capital": "Ready Capital",
    "tmc financing": "TMC Financing CDC",
    "roc capital": "Roc Capital",
    "roc360": "Roc Capital",
    "fidelis private fund": "Fidelis Private Fund",
}


def norm(name: str) -> str:
    n = (name or "").lower()
    n = re.sub(r"\(.*?\)", " ", n)
    n = n.replace("&", " and ")
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = re.sub(r"\b(llc|inc|corp|corporation|co|lp|l p|the)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def existing_match(name: str, parent: str) -> str:
    hay = norm(name)
    for key in EXISTING:
        if re.search(r"\b" + re.escape(key) + r"\b", hay):
            return "Yes"
    return "No"


def clean(v):
    if v is None:
        return ""
    if isinstance(v, str):
        v = v.strip()
        if v.lower() in {"null", "none", "n/a", "unknown", "not found", "not published"}:
            return ""
        return v
    return v


def as_int(v):
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).replace(",", "").replace("$", "").strip().upper()
    m = re.match(r"^([\d.]+)\s*([KMB])?$", s)
    if not m:
        return None
    mult = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}.get(m.group(2), 1)
    return int(float(m.group(1)) * mult)


def first_url(v):
    v = clean(v)
    if not v or not isinstance(v, str):
        return ""
    m = re.search(r"https?://\S+", v)
    return m.group(0).rstrip(").,;") if m else ""


# ---------------------------------------------------------------- load
records, excluded = [], []
ROUND_LABEL = {1: "Round 1 (2026-11-02)", 2: "Round 2 (2026-11-03)"}
for path in sorted(RESEARCH_DIR.rglob("lenders_*.json")):
    data = json.loads(path.read_text())
    rnd = 2 if path.parent.name == "research2" else 1
    for r in data.get("lenders", []):
        r["_file"] = path.name
        r["_round"] = rnd
        records.append(r)
    for x in data.get("excluded", []):
        x["_file"] = path.name
        excluded.append(x)

# Manual overrides (reviewed decisions + verification fixes): overrides.json beside the research files.
OVR_PATH = RESEARCH_DIR / "overrides.json"
OVR = json.loads(OVR_PATH.read_text()) if OVR_PATH.exists() else {"drop": [], "patch": []}

def exact(n):
    return re.sub(r"\s+", " ", (n or "").strip().lower())

def _match(r, sel):
    if sel.get("name") and exact(sel["name"]) != exact(r.get("name")):
        return False
    if sel.get("file") and sel["file"] != r.get("_file"):
        return False
    if sel.get("subcategory") and sel["subcategory"] != r.get("subcategory"):
        return False
    return True

kept = []
for r in records:
    hit = next((d for d in OVR.get("drop", []) if _match(r, d)), None)
    if hit:
        excluded.append({"name": r.get("name"), "reason": hit["reason"],
                         "source": (r.get("sources") or [""])[0], "_file": r["_file"]})
        continue
    for pt in OVR.get("patch", []):
        if _match(r, pt):
            for k, v in pt["set"].items():
                r[k] = v
    kept.append(r)
records = kept

# Independent Tier A re-check (verify_out_*.json): corrections, blanks, downgrades, inactive -> excluded.
VERIFY = {}
for vp in sorted(RESEARCH_DIR.rglob("verify_out_*.json")):
    for v in json.loads(vp.read_text()).get("results", []):
        VERIFY.setdefault(exact(v.get("name")), []).append(v)
kept = []
for r in records:
    vs = VERIFY.get(exact(r.get("name")), [])
    if any(str(v.get("active_2026", "")).lower() == "no" for v in vs):
        v = next(v for v in vs if str(v.get("active_2026", "")).lower() == "no")
        excluded.append({"name": r.get("name"), "reason": "Tier A re-check: not active in 2026. " + (v.get("note") or ""),
                         "source": (v.get("evidence") or [""])[0], "_file": "verify"})
        continue
    notes = []
    for v in vs:
        for k, val in (v.get("set") or {}).items():
            r[k] = val
        for k in v.get("clear") or []:
            r[k] = None
        r["sources"] = list(dict.fromkeys((r.get("sources") or []) + [e for e in (v.get("evidence") or []) if isinstance(e, str)]))
        verdict = {"verified": "Verified", "corrected": "Corrected", "flag": "Flagged"}.get(v.get("verdict"), v.get("verdict") or "")
        notes.append(f"{verdict} (active 2026: {v.get('active_2026', '?')}). {v.get('note') or ''}".strip())
    if notes:
        r["_qa"] = " / ".join(dict.fromkeys(notes))
    kept.append(r)
records = kept
# Reconciliations made after reading both re-check reports (applied last).
for r in records:
    for pt in OVR.get("post_patch", []):
        if _match(r, pt):
            for k, v in pt["set"].items():
                r[k] = v
for x in OVR.get("add_excluded", []):
    excluded.append(dict(x, _file=x.get("_file", "review")))

# Normalise and de-duplicate within the same category (same desk). Keep the record
# with more filled fields, and union the sources.
def filled(r):
    return sum(1 for v in r.values() if v not in (None, "", [], {}))

# brand key: groups the same lender across desks / spellings
BRAND_STOP = {"and", "capital", "real", "estate", "realty", "trust", "financial", "finance", "financing",
              "group", "partners", "funding", "lending", "mortgage", "corp", "company", "companies",
              "investment", "investments", "management", "advisors", "llc", "inc", "na", "n a"}
BRAND_ALIAS = {"roc360": "roc", "orix": "orix", "lancaster pollard": "orix"}

def brand_key(name):
    n = norm(name)
    for k, v in BRAND_ALIAS.items():
        if re.search(r"\b" + re.escape(k) + r"\b", n):
            return v
    toks = [t for t in n.split() if t not in BRAND_STOP]
    return " ".join(toks) or n

by_key = OrderedDict()
for r in records:
    for k in list(r):
        r[k] = clean(r[k]) if not isinstance(r[k], list) else r[k]
    cat = r.get("category") or ""
    if cat not in CATEGORY_ORDER:
        # map loose labels
        low = cat.lower()
        if "senior" in low or "health" in low:
            cat = "Senior Living / Healthcare"
        elif "construct" in low:
            cat = "Construction"
        elif "multifamily" in low or "multi-family" in low:
            cat = "Multifamily"
        elif "hospitality" in low or "hotel" in low:
            cat = "Hospitality"
        elif "institutional" in low or "capital markets" in low:
            cat = "Institutional / Capital Markets"
        elif "bank" in low or "sba" in low:
            cat = "Bank / SBA"
        else:
            cat = "Hard Money / Bridge"
        r["category"] = cat
    tier = str(r.get("tier") or "C").strip().upper()[:1]
    r["tier"] = tier if tier in TIER_ORDER else "C"
    sub = (r.get("subcategory") or "")
    desk = ("hud" if sub.startswith("HUD") else "other") if cat.startswith("Senior") else ""
    key = (brand_key(r.get("name")), cat, desk)
    if key in by_key:
        CONF = {"High": 2, "Medium": 1, "Low": 0}
        a, b = by_key[key], r
        score = lambda x: (CONF.get(x.get("confidence"), 0), filled(x))
        if a.get("_round", 1) != b.get("_round", 1):
            # An earlier round's row keeps its name and desk, so ids already loaded stay stable.
            keep, other = (a, b) if a.get("_round", 1) < b.get("_round", 1) else (b, a)
        else:
            keep, other = (a, b) if score(a) >= score(b) else (b, a)
        if other.get("subcategory") and other.get("subcategory") != keep.get("subcategory"):
            extra = f"Also fits: {other['subcategory']}."
            if extra not in (keep.get("fit_notes") or ""):
                keep["fit_notes"] = ((keep.get("fit_notes") or "") + " " + extra).strip()
        for fld in ("programs", "broker_program"):
            o, k_ = other.get(fld) or "", keep.get(fld) or ""
            if o and o not in k_ and len(k_) < 900:
                keep[fld] = (k_ + " | Other source: " + o).strip(" |") if k_ else o
        srcs = list(dict.fromkeys((keep.get("sources") or []) + (other.get("sources") or [])))
        for k, v in other.items():
            if keep.get(k) in (None, "") and v not in (None, ""):
                keep[k] = v
        keep["sources"] = srcs
        # keep the better (lower) tier letter if they disagree
        keep["tier"] = min(keep["tier"], other["tier"], key=lambda t: TIER_ORDER[t])
        by_key[key] = keep
    else:
        by_key[key] = r

lenders = list(by_key.values())
SUB_ORDER = [
    # Construction
    "CRE construction debt fund / private", "CRE construction bank", "Land / horizontal development",
    "Construction mezz / pref equity / C-PACE", "Investor ground-up (wholesale)",
    # Hard money / bridge
    "California private money", "National commercial hard money", "Commercial bridge / transitional",
    "Small-balance commercial (SBC)", "Hospitality bridge / PIP", "Investor fix & flip / bridge (wholesale)",
    "Investor DSCR rental take-out (wholesale)",
    # Senior living
    "HUD 232 / Agency (permanent & construction)", "Healthcare bridge / bridge-to-HUD",
    "Healthcare bank / balance sheet", "Senior housing construction", "Healthcare mezz / pref equity",
    "SBA / small care facility (RCFE, assisted living)",
    # Multifamily
    "Agency multifamily (Fannie / Freddie)", "HUD multifamily (221(d)(4) / 223(f))", "Multifamily bridge / value-add",
    "Small-balance multifamily (5-50 units)", "Multifamily bank / credit union",
    # Hospitality
    "SBA hotel lender (7(a) / 504)", "Hotel bridge / PIP", "Hotel construction",
    # Institutional / capital markets
    "Life insurance company", "CMBS conduit", "Mortgage REIT / large-balance debt fund", "Hedge fund / private credit",
    "Family office / private capital",
    # Bank / SBA
    "Community bank / credit union CRE", "SBA 504 CDC", "SBA 7(a) lender",
]
def _sub_rank(sub):
    return SUB_ORDER.index(sub) if sub in SUB_ORDER else len(SUB_ORDER)
lenders.sort(key=lambda r: (
    CATEGORY_ORDER.index(r["category"]),
    _sub_rank(r.get("subcategory") or ""),
    TIER_ORDER[r["tier"]],
    (r.get("name") or "").lower(),
))

counters = {c: 0 for c in CATEGORY_ORDER}
for r in lenders:
    counters[r["category"]] += 1
    r["_id"] = f"{CATEGORY_PREFIX[r['category']]}-{counters[r['category']]:03d}"
    r["_existing"] = existing_match(r.get("name"), r.get("parent_or_aka"))

# cross-reference: same lender listed under another category or subcategory
name_ids = {}
for r in lenders:
    name_ids.setdefault(brand_key(r.get("name")), []).append(r["_id"])
for r in lenders:
    others = [i for i in name_ids[brand_key(r.get("name"))] if i != r["_id"]]
    r["_also"] = ", ".join(others)

# ---------------------------------------------------------------- styles
def font(**kw):
    base = dict(name=FONT, size=10)
    base.update(kw)
    return Font(**base)

HDR_FONT = font(bold=True, color="FFFFFF")
HDR_FILL = PatternFill("solid", fgColor=NAVY)
TRACK_HDR_FILL = PatternFill("solid", fgColor="7F6000")
INPUT_FILL = PatternFill("solid", fgColor=YELLOW)
LINK_FONT = font(color="0563C1", underline="single")
WRAP_TOP = Alignment(wrap_text=True, vertical="top")
TOP = Alignment(vertical="top")
CENTER_TOP = Alignment(horizontal="center", vertical="top")

wb = Workbook()

# ================================================================ Lenders sheet
ws = wb.active
ws.title = "Lenders"

# (header, width, getter, kind) kind: text|wrap|money|link|center|date|input
COLS = [
    ("ID", 8, lambda r: r["_id"], "center"),
    ("Lender", 30, lambda r: r.get("name"), "bold"),
    ("Parent / also known as", 24, lambda r: r.get("parent_or_aka"), "wrap"),
    ("Category", 20, lambda r: r["category"], "wrap"),
    ("Subcategory", 26, lambda r: r.get("subcategory"), "wrap"),
    ("Tier", 6, lambda r: r["tier"], "center"),
    ("Existing Corin relationship", 12, lambda r: r["_existing"], "center"),
    ("Lender type", 16, lambda r: r.get("lender_type"), "wrap"),
    ("Lends in CA", 10, lambda r: r.get("lends_in_california") or "Unconfirmed", "center"),
    ("Footprint", 22, lambda r: r.get("footprint"), "wrap"),
    ("HQ", 18, lambda r: ", ".join(x for x in [r.get("hq_city"), r.get("hq_state")] if x), "wrap"),
    ("Property types", 34, lambda r: r.get("property_types"), "wrap"),
    ("Loan programs", 38, lambda r: r.get("programs"), "wrap"),
    ("Min loan ($)", 13, lambda r: as_int(r.get("min_loan_usd")), "money"),
    ("Max loan ($)", 14, lambda r: as_int(r.get("max_loan_usd")), "money"),
    ("Max leverage", 20, lambda r: r.get("max_leverage"), "wrap"),
    ("Rate range", 20, lambda r: r.get("rate_range"), "wrap"),
    ("Term", 18, lambda r: r.get("term"), "wrap"),
    ("Recourse", 16, lambda r: r.get("recourse"), "wrap"),
    ("Lien position", 14, lambda r: r.get("lien_position"), "wrap"),
    ("Speed to close", 16, lambda r: r.get("speed_to_close"), "wrap"),
    ("Broker program (how they work with / pay brokers)", 50, lambda r: r.get("broker_program"), "wrap"),
    ("Broker sign-up / broker page", 26, lambda r: first_url(r.get("broker_signup_url")), "link"),
    ("Website", 24, lambda r: first_url(r.get("website")), "link"),
    ("Phone", 16, lambda r: r.get("phone"), "wrap"),
    ("Email", 26, lambda r: r.get("email"), "wrap"),
    ("HQ address", 28, lambda r: r.get("address"), "wrap"),
    ("Public contact", 20, lambda r: r.get("contact_name"), "wrap"),
    ("Contact title", 22, lambda r: r.get("contact_title"), "wrap"),
    ("Licenses / approvals", 26, lambda r: r.get("licenses"), "wrap"),
    ("Fit for Corin / notes", 44, lambda r: r.get("fit_notes"), "wrap"),
    ("Same lender, other desk", 12, lambda r: r["_also"], "wrap"),
    ("Confidence", 11, lambda r: r.get("confidence"), "center"),
    ("Second check", 30, lambda r: r.get("_qa"), "wrap"),
    ("Last verified", 12, lambda r: r.get("last_verified") or AS_OF, "center"),
    ("Added", 14, lambda r: ROUND_LABEL[r.get("_round", 1)], "center"),
    ("Primary source", 26, lambda r: (r.get("sources") or [""])[0], "link"),
    ("# sources", 9, lambda r: len(r.get("sources") or []), "center"),
    # --- outreach tracking (user inputs)
    ("Outreach owner", 14, lambda r: "", "input"),
    ("Status", 20, lambda r: "Existing relationship" if r["_existing"] == "Yes" else "Not started", "input"),
    ("First contact date", 12, lambda r: None, "inputdate"),
    ("Last touch date", 12, lambda r: None, "inputdate"),
    ("Next step", 26, lambda r: "", "input"),
    ("Next step date", 12, lambda r: None, "inputdate"),
    ("Broker / fee agreement signed", 12, lambda r: "", "input"),
    ("Account approved date", 12, lambda r: None, "inputdate"),
    ("Assigned account rep", 20, lambda r: "", "input"),
    ("Rep email / phone", 24, lambda r: "", "input"),
    ("Notes", 36, lambda r: "", "input"),
]
COLIDX = {h: i + 1 for i, (h, *_rest) in enumerate(COLS)}
TRACK_START = COLIDX["Outreach owner"]

for c, (h, w, _g, kind) in enumerate(COLS, start=1):
    cell = ws.cell(row=1, column=c, value=h)
    cell.font = HDR_FONT
    cell.fill = TRACK_HDR_FILL if c >= TRACK_START else HDR_FILL
    cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
    cell.border = BORDER
    ws.column_dimensions[get_column_letter(c)].width = w
ws.row_dimensions[1].height = 42

for i, r in enumerate(lenders, start=2):
    for c, (h, _w, getter, kind) in enumerate(COLS, start=1):
        val = getter(r)
        if val == "":
            val = None
        cell = ws.cell(row=i, column=c, value=val)
        cell.border = BORDER
        if kind == "bold":
            cell.font = font(bold=True)
            cell.alignment = WRAP_TOP
        elif kind == "center":
            cell.font = font()
            cell.alignment = CENTER_TOP
        elif kind == "money":
            cell.font = font()
            cell.number_format = '$#,##0;($#,##0);"-"'
            cell.alignment = TOP
        elif kind == "link":
            cell.alignment = WRAP_TOP
            if val:
                cell.hyperlink = val
                cell.font = LINK_FONT
            else:
                cell.font = font()
        elif kind in ("input", "inputdate"):
            cell.fill = INPUT_FILL
            cell.font = font(color="0000FF")
            cell.alignment = WRAP_TOP
            if kind == "inputdate":
                cell.number_format = "yyyy-mm-dd"
        else:
            cell.font = font()
            cell.alignment = WRAP_TOP
    ws.row_dimensions[i].height = 90

last_row = len(lenders) + 1
MAX_ROW = 600  # validation / formula ranges leave room for added lenders
ws.freeze_panes = "C2"
ws.auto_filter.ref = f"A1:{get_column_letter(len(COLS))}{last_row}"

# Comments that explain the trickier headers
ws.cell(1, COLIDX["Tier"]).comment = Comment(
    "A = documented broker channel (broker page/portal, or recent intermediary-arranged loans) + lends in CA + core product fit.\n"
    "B = strong fit, one element unconfirmed.\nC = niche / narrow / partial fit.", "Research")
ws.cell(1, COLIDX["Confidence"]).comment = Comment(
    "High = terms and broker channel confirmed on the lender's own site or 2025-26 release.\n"
    "Medium = mix of lender site and third-party.\nLow = mostly third-party or pre-2024.", "Research")
ws.cell(1, COLIDX["Existing Corin relationship"]).comment = Comment(
    "Yes = lender already in Corin's routing table (lib/ai/lenders.ts).", "Research")
ws.cell(1, COLIDX["Second check"]).comment = Comment(
    "Independent second check, run on every Tier A lender (and copied to that lender's other rows): active in 2026, website, broker page, phone, contact, CA lending. "
    "Corrections are already applied to the row.", "Research")
ws.cell(1, COLIDX["Same lender, other desk"]).comment = Comment(
    "IDs of rows for the same lender under another category (different desk / contacts).", "Research")
ws.cell(1, COLIDX["Min loan ($)"]).comment = Comment(
    "As published by the lender. Blank = not published.", "Research")

def col(h):
    return get_column_letter(COLIDX[h])

dv_status = DataValidation(type="list", formula1='"' + ",".join(STATUSES) + '"', allow_blank=True)
dv_status.add(f"{col('Status')}2:{col('Status')}{MAX_ROW}")
dv_agree = DataValidation(type="list", formula1='"' + ",".join(AGREEMENT) + '"', allow_blank=True)
dv_agree.add(f"{col('Broker / fee agreement signed')}2:{col('Broker / fee agreement signed')}{MAX_ROW}")
dv_tier = DataValidation(type="list", formula1='"A,B,C"', allow_blank=True)
dv_tier.add(f"{col('Tier')}2:{col('Tier')}{MAX_ROW}")
dv_ca = DataValidation(type="list", formula1='"Yes,No,Unconfirmed"', allow_blank=True)
dv_ca.add(f"{col('Lends in CA')}2:{col('Lends in CA')}{MAX_ROW}")
dv_date = DataValidation(type="date", operator="greaterThan", formula1="DATE(2020,1,1)", allow_blank=True,
                         error="Enter a date (yyyy-mm-dd).", errorTitle="Date")
for h in ["First contact date", "Last touch date", "Next step date", "Account approved date"]:
    dv_date.add(f"{col(h)}2:{col(h)}{MAX_ROW}")
for dv in (dv_status, dv_agree, dv_tier, dv_ca, dv_date):
    ws.add_data_validation(dv)

tier_rng = f"{col('Tier')}2:{col('Tier')}{MAX_ROW}"
ws.conditional_formatting.add(tier_rng, CellIsRule(operator="equal", formula=['"A"'],
                              fill=PatternFill("solid", fgColor="C6EFCE"), font=font(bold=True, color="006100")))
ws.conditional_formatting.add(tier_rng, CellIsRule(operator="equal", formula=['"B"'],
                              fill=PatternFill("solid", fgColor="FFEB9C"), font=font(bold=True, color="9C5700")))
ws.conditional_formatting.add(tier_rng, CellIsRule(operator="equal", formula=['"C"'],
                              fill=PatternFill("solid", fgColor="EDEDED"), font=font(color="595959")))
ex_rng = f"{col('Existing Corin relationship')}2:{col('Existing Corin relationship')}{MAX_ROW}"
ws.conditional_formatting.add(ex_rng, CellIsRule(operator="equal", formula=['"Yes"'],
                              fill=PatternFill("solid", fgColor="DDEBF7"), font=font(bold=True, color="1F3864")))
st = col("Status")
st_rng = f"{st}2:{st}{MAX_ROW}"
ws.conditional_formatting.add(st_rng, FormulaRule(formula=[f'LEFT(${st}2,8)="Approved"'],
                              fill=PatternFill("solid", fgColor="C6EFCE")))
ws.conditional_formatting.add(st_rng, FormulaRule(formula=[f'${st}2="Declined / not a fit"'],
                              fill=PatternFill("solid", fgColor="FFC7CE")))
# overdue next step: date in the past and not approved/declined
nd = col("Next step date")
ws.conditional_formatting.add(f"{nd}2:{nd}{MAX_ROW}", FormulaRule(
    formula=[f'AND(${nd}2<>"",${nd}2<TODAY(),LEFT(${st}2,8)<>"Approved",${st}2<>"Declined / not a fit")'],
    fill=PatternFill("solid", fgColor="FFC7CE"), font=font(bold=True, color="9C0006")))

# ================================================================ Sources sheet
src = wb.create_sheet("Sources")
for c, (h, w) in enumerate([("ID", 8), ("Lender", 32), ("Category", 22), ("#", 5), ("Source URL", 110)], start=1):
    cell = src.cell(1, c, h)
    cell.font, cell.fill, cell.border = HDR_FONT, HDR_FILL, BORDER
    cell.alignment = Alignment(horizontal="center", vertical="center")
    src.column_dimensions[get_column_letter(c)].width = w
row = 2
for r in lenders:
    for n, u in enumerate(r.get("sources") or [], start=1):
        vals = [r["_id"], r.get("name"), r["category"], n, u]
        for c, v in enumerate(vals, start=1):
            cell = src.cell(row, c, v)
            cell.font = font()
            cell.border = BORDER
            if c == 5 and isinstance(u, str) and u.startswith("http"):
                cell.hyperlink = u
                cell.font = LINK_FONT
        row += 1
src.freeze_panes = "C2"
src.auto_filter.ref = f"A1:E{max(row - 1, 1)}"

# ================================================================ Excluded sheet
exs = wb.create_sheet("Excluded & Watchlist")
for c, (h, w) in enumerate([("Lender", 34), ("Why excluded / watch", 90), ("Source", 60), ("Research segment", 26)], start=1):
    cell = exs.cell(1, c, h)
    cell.font, cell.fill, cell.border = HDR_FONT, HDR_FILL, BORDER
    cell.alignment = Alignment(horizontal="center", vertical="center")
    exs.column_dimensions[get_column_letter(c)].width = w
SEGMENT = {
    "lenders_A_hud_agency_seniors.json": "Senior living - HUD 232 / Agency",
    "lenders_B_seniors_bridge_bank.json": "Senior living - bridge / bank / construction",
    "lenders_C_cre_construction.json": "CRE construction",
    "lenders_D_investor_wholesale.json": "Investor wholesale (construction / fix & flip)",
    "lenders_E_california_private.json": "California private money",
    "lenders_F_national_bridge.json": "National commercial bridge / hard money",
    "lenders_G_multifamily.json": "Round 2: multifamily",
    "lenders_H_lifeco_cmbs.json": "Round 2: life companies and CMBS",
    "lenders_I_hedge_reit.json": "Round 2: hedge funds, REITs, family offices",
    "lenders_J_hospitality.json": "Round 2: hospitality and SBA hotel",
    "lenders_K_ca_banks_sba.json": "Round 2: California banks, credit unions, SBA",
    "lenders_L_construction_hm_gaps.json": "Round 2: construction and hard money gaps",
    "lenders_M_senior_gaps.json": "Round 2: senior living gaps",
    "verify": "Second check",
    "review": "Merge review",
}
listed_brands = {brand_key(r.get("name")) for r in lenders}
seen_ex = set()
row = 2
for x in sorted(excluded, key=lambda x: (x.get("name") or "").lower()):
    k = norm(x.get("name"))
    bk = brand_key(x.get("name")).split()
    def _prefix(a, b):
        return len(" ".join(a)) >= 4 and a == b[:len(a)]
    if k in seen_ex or not k or any(_prefix(lb.split(), bk) or _prefix(bk, lb.split()) for lb in listed_brands):
        continue
    if str(x.get("reason", "")).lower().startswith("seed name not verified"):
        continue
    seen_ex.add(k)
    s = x.get("source") or ""
    if isinstance(s, list):
        s = s[0] if s else ""
    reason = OVR.get("excluded_reason", {}).get(x.get("name"), x.get("reason"))
    vals = [x.get("name"), reason, s, SEGMENT.get(x["_file"], x["_file"])]
    for c, v in enumerate(vals, start=1):
        cell = exs.cell(row, c, v)
        cell.font = font()
        cell.border = BORDER
        cell.alignment = WRAP_TOP
        if c == 3 and isinstance(v, str) and v.startswith("http"):
            cell.hyperlink = v
            cell.font = LINK_FONT
    row += 1
exs.freeze_panes = "B2"
exs.auto_filter.ref = f"A1:D{max(row - 1, 1)}"

# ================================================================ Dashboard
db = wb.create_sheet("Dashboard", 0)
db.sheet_view.showGridLines = False
db.column_dimensions["A"].width = 50
db.column_dimensions["B"].width = 26
for c in "CDEFGHIJ":
    db.column_dimensions[c].width = 16

L = "Lenders"
def rng(h):
    c = col(h)
    return f"{L}!${c}$2:${c}${MAX_ROW}"

R_CAT, R_TIER, R_CA, R_EX, R_SUB = rng("Category"), rng("Tier"), rng("Lends in CA"), rng("Existing Corin relationship"), rng("Subcategory")
R_STATUS, R_SIGNUP, R_CONF = rng("Status"), rng("Broker sign-up / broker page"), rng("Confidence")
R_AGREE = rng("Broker / fee agreement signed")

def title(cell, text, size=14):
    db[cell] = text
    db[cell].font = font(bold=True, size=size, color=NAVY)

def hdr_row(r, labels, start_col=1):
    for i, lab in enumerate(labels):
        c = db.cell(r, start_col + i, lab)
        c.font, c.fill, c.border = HDR_FONT, HDR_FILL, BORDER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

def body(r, c, v, fmt=None, bold=False, fill=None):
    cell = db.cell(r, c, v)
    cell.font = font(bold=bold)
    cell.border = BORDER
    if fmt:
        cell.number_format = fmt
    if fill:
        cell.fill = PatternFill("solid", fgColor=fill)
    cell.alignment = Alignment(horizontal="left" if c == 1 else "center", vertical="center")
    return cell

title("A1", "Wholesale Lender Directory: Dashboard", 16)
db["A2"] = f"Corin Commercial, Inc.  |  Research as of {AS_OF}  |  Counts update from the Lenders sheet"
db["A2"].font = font(italic=True, color="595959")

# --- Table 1: category x tier
r0 = 4
title(f"A{r0}", "Lenders by category and tier", 12)
hdr_row(r0 + 1, ["Category", "Tier A", "Tier B", "Tier C", "Total", "Lends in CA (Yes)", "Has broker sign-up link", "Existing relationship"])
for i, cat in enumerate(CATEGORY_ORDER):
    rr = r0 + 2 + i
    body(rr, 1, cat)
    for j, t in enumerate("ABC"):
        body(rr, 2 + j, f'=COUNTIFS({R_CAT},$A{rr},{R_TIER},"{t}")')
    body(rr, 5, f"=SUM(B{rr}:D{rr})", bold=True)
    body(rr, 6, f'=COUNTIFS({R_CAT},$A{rr},{R_CA},"Yes")')
    body(rr, 7, f'=COUNTIFS({R_CAT},$A{rr},{R_SIGNUP},"<>")')
    body(rr, 8, f'=COUNTIFS({R_CAT},$A{rr},{R_EX},"Yes")')
tot = r0 + 2 + len(CATEGORY_ORDER)
body(tot, 1, "Total", bold=True, fill=GREY)
for c in range(2, 9):
    L_ = get_column_letter(c)
    body(tot, c, f"=SUM({L_}{r0 + 2}:{L_}{tot - 1})", bold=True, fill=GREY)

# --- Table 2: outreach pipeline (one column per category, then the total)
TOT_COL = 2 + len(CATEGORY_ORDER)
LAST_CAT = get_column_letter(TOT_COL - 1)
r1 = tot + 3
title(f"A{r1}", "Outreach pipeline (edit Status on the Lenders sheet)", 12)
hdr_row(r1 + 1, ["Status"] + CATEGORY_ORDER + ["Total"])
for i, s in enumerate(STATUSES):
    rr = r1 + 2 + i
    body(rr, 1, s)
    for j, cat in enumerate(CATEGORY_ORDER):
        body(rr, 2 + j, f'=COUNTIFS({R_STATUS},$A{rr},{R_CAT},"{cat}")')
    body(rr, TOT_COL, f"=SUM(B{rr}:{LAST_CAT}{rr})", bold=True)
ptot = r1 + 2 + len(STATUSES)
body(ptot, 1, "Total", bold=True, fill=GREY)
for c in range(2, TOT_COL + 1):
    L_ = get_column_letter(c)
    body(ptot, c, f"=SUM({L_}{r1 + 2}:{L_}{ptot - 1})", bold=True, fill=GREY)
rr = ptot + 1
body(rr, 1, "Accounts open (approved + existing) as % of total", bold=True)
approved_row = r1 + 2 + STATUSES.index("Approved - account open")
existing_row = r1 + 2 + STATUSES.index("Existing relationship")
for c in range(2, TOT_COL + 1):
    L_ = get_column_letter(c)
    body(rr, c, f"=IF({L_}{ptot}=0,0,({L_}{approved_row}+{L_}{existing_row})/{L_}{ptot})", fmt="0.0%", bold=(c == TOT_COL))
rr += 1
body(rr, 1, "Broker / fee agreements signed (Yes)")
for j, cat in enumerate(CATEGORY_ORDER):
    body(rr, 2 + j, f'=COUNTIFS({R_AGREE},"Yes",{R_CAT},"{cat}")')
body(rr, TOT_COL, f"=SUM(B{rr}:{LAST_CAT}{rr})", bold=True)

# --- Table 3: subcategory
r2 = rr + 3
title(f"A{r2}", "Lenders by subcategory", 12)
hdr_row(r2 + 1, ["Subcategory", "Category", "Lenders", "Tier A", "Lends in CA (Yes)", "High confidence"])
subs = OrderedDict()
for r in lenders:
    subs.setdefault((r["category"], r.get("subcategory") or ""), None)
for i, (cat, sub) in enumerate(subs):
    rr = r2 + 2 + i
    body(rr, 1, sub)
    body(rr, 2, cat)
    body(rr, 3, f'=COUNTIFS({R_SUB},$A{rr},{R_CAT},$B{rr})', bold=True)
    body(rr, 4, f'=COUNTIFS({R_SUB},$A{rr},{R_CAT},$B{rr},{R_TIER},"A")')
    body(rr, 5, f'=COUNTIFS({R_SUB},$A{rr},{R_CAT},$B{rr},{R_CA},"Yes")')
    body(rr, 6, f'=COUNTIFS({R_SUB},$A{rr},{R_CAT},$B{rr},{R_CONF},"High")')
db.freeze_panes = "A4"

# ================================================================ Account setup
acc = wb.create_sheet("Account Setup")
acc.sheet_view.showGridLines = False
acc.column_dimensions["A"].width = 5
acc.column_dimensions["B"].width = 44
acc.column_dimensions["C"].width = 70
acc.column_dimensions["D"].width = 16
acc.column_dimensions["E"].width = 16
acc.column_dimensions["F"].width = 30
acc["A1"] = "Broker account setup: one approval package, reused for every lender"
acc["A1"].font = font(bold=True, size=14, color=NAVY)
acc["A2"] = ("Most lenders ask for the same documents. Build this package once, keep it current, and attach it to each "
             "broker application. Yellow cells are yours to fill in.")
acc["A2"].font = font(italic=True, color="595959")
hdrs = ["#", "Document", "What lenders look for", "Status", "Expires", "Where stored / notes"]
for c, h in enumerate(hdrs, start=1):
    cell = acc.cell(4, c, h)
    cell.font, cell.fill, cell.border = HDR_FONT, HDR_FILL, BORDER
    cell.alignment = Alignment(horizontal="center", vertical="center")
PACKAGE = [
    ("Broker application (lender's own form)", "Every lender has one; many are online via the broker sign-up link on the Lenders sheet."),
    ("Corporate DRE license: Corin Commercial, Inc.", "License number, status 'licensed', designated officer. Print from the DRE public license lookup."),
    ("Individual DRE licenses of each originator", "Lenders that pay broker compensation need the payee to be licensed; some ask per loan officer."),
    ("NMLS IDs (company and individual), if held", "Business-purpose commercial loans usually do not require NMLS, but some investor-loan portals ask for it."),
    ("IRS Form W-9", "Needed before any broker fee is paid at closing."),
    ("Articles of incorporation + CA SOS Statement of Information", "Proof the entity exists and is in good standing; some also ask for a Certificate of Good Standing."),
    ("E&O / professional liability insurance certificate", "Some institutional lenders and HUD/agency lenders ask for it; record carrier and limits."),
    ("Signed broker agreement / non-circumvention and fee-protection agreement", "Lender-specific. Confirm how and when the fee is earned, the fee cap, and that it appears on the closing statement."),
    ("Broker compensation wiring instructions (on letterhead)", "Verify by phone on every closing to prevent wire fraud."),
    ("Firm resume and track record", "Deals arranged (type, size, lender), team bios, years of experience, target markets."),
    ("Two or three references", "Other lenders, title or escrow officers who have closed deals with you."),
    ("Standard loan submission template", "Executive summary, sources and uses, T-12 and rent roll / census, PFS and REO schedule, entity chart, photos."),
    ("HUD / agency: fee-sharing confirmation", "On HUD-insured and agency loans, confirm with the lender how an outside broker's fee is paid and shown on the closing statement."),
    ("Principal background / credit authorization", "Some private lenders and debt funds run background checks on the broker's principals."),
]
for i, (doc, look) in enumerate(PACKAGE, start=1):
    r = 4 + i
    vals = [i, doc, look, "Not started", None, None]
    for c, v in enumerate(vals, start=1):
        cell = acc.cell(r, c, v)
        cell.font = font(color="0000FF") if c >= 4 else font()
        cell.border = BORDER
        cell.alignment = WRAP_TOP
        if c >= 4:
            cell.fill = INPUT_FILL
        if c == 5:
            cell.number_format = "yyyy-mm-dd"
    acc.row_dimensions[r].height = 32
dv_pkg = DataValidation(type="list", formula1='"Not started,In progress,Done,N/A"', allow_blank=True)
acc.add_data_validation(dv_pkg)
dv_pkg.add(f"D5:D{4 + len(PACKAGE)}")

r = 6 + len(PACKAGE)
acc.cell(r, 1, "California compliance reminders when you broker these loans").font = font(bold=True, size=12, color=NAVY)
NOTES = [
    "Give the borrower a Mortgage Loan Disclosure Statement (DRE RE 882) on every brokered loan secured by real property, commercial included. It is due within 3 business days of a completed application and before the borrower is obligated. It must show all broker compensation, including lender-paid fees.",
    "Do not table-fund or close a loan in Corin's name. Corin arranges; the lender funds as lender of record. The repo's counsel notes flag Corin-named table funding for attorney review.",
    "California usury: the 'arranged by a licensed broker' exemption (Civ. Code §1916.1) depends on Corin actually soliciting or negotiating the loan for compensation. Keep the negotiation log and fee agreement in the file.",
    "Put the DRE license number and the 'Real estate broker, California Department of Real Estate' statement on outreach emails, decks and ads.",
    "Source: research_notes/Loan program expansion gap analysis/counsel_gate_A_mlds.md and counsel_gate_H_usury.md in this repo. That research is not legal advice and a California attorney must confirm it.",
]
for i, n in enumerate(NOTES, start=1):
    cell = acc.cell(r + i, 2, f"{i}. {n}" if i < len(NOTES) else n)
    acc.merge_cells(start_row=r + i, start_column=2, end_row=r + i, end_column=6)
    cell.font = font(italic=(i == len(NOTES)), color="595959" if i == len(NOTES) else "000000")
    cell.alignment = WRAP_TOP
    acc.row_dimensions[r + i].height = 42

r = r + len(NOTES) + 2
acc.cell(r, 1, "First-contact email: broker account request (edit before sending)").font = font(bold=True, size=12, color=NAVY)
EMAIL = (
    "Subject: Broker account request: Corin Commercial (California DRE-licensed commercial mortgage broker)\n\n"
    "Hello [Name],\n\n"
    "I'm [Your name], [title] at Corin Commercial, Inc., a California DRE-licensed commercial mortgage broker "
    "(DRE Corp. Lic. #[________]). We arrange [construction / bridge and hard money / senior living and healthcare] "
    "financing for sponsors in California and the West, typically $[__]M to $[__]M.\n\n"
    "We'd like to open a broker account with [Lender] and send you deals that fit your [program] box. "
    "Could you send your broker application and current term sheet or matrix, and tell me who covers California? "
    "I can send our approval package (DRE licenses, W-9, entity documents, track record) today.\n\n"
    "We have [one or two] live files that may fit: [one-line deal summary].\n\n"
    "Thank you,\n[Name] | [Phone] | [Email]\n"
    "Corin Commercial, Inc. | Real estate broker, California Department of Real Estate | DRE #[________]"
)
cell = acc.cell(r + 1, 2, EMAIL)
acc.merge_cells(start_row=r + 1, start_column=2, end_row=r + 1, end_column=6)
cell.font = font()
cell.alignment = WRAP_TOP
cell.fill = INPUT_FILL
cell.border = BORDER
acc.row_dimensions[r + 1].height = 250

# ================================================================ Start Here
sh = wb.create_sheet("Start Here", 0)
sh.sheet_view.showGridLines = False
sh.column_dimensions["A"].width = 3
sh.column_dimensions["B"].width = 30
sh.column_dimensions["C"].width = 100
sh["B1"] = "Wholesale Lender Directory: construction, hard money, senior living, multifamily, hospitality and institutional capital"
sh["B1"].font = font(bold=True, size=16, color=NAVY)
sh["B2"] = f"Prepared for Corin Commercial, Inc.  |  Public-source research as of {AS_OF}"
sh["B2"].font = font(italic=True, color="595959")

rows = [
    ("WHAT'S INSIDE", None),
    ("Dashboard", "Live counts by category, tier, California reach and outreach status. Formulas only; nothing to edit."),
    ("Lenders", f"The master list: {len(lenders)} lender desks, one row each. Grey/navy columns are research; the yellow columns on the right (from 'Outreach owner') are your tracker."),
    ("Account Setup", "The document package lenders ask for, California compliance reminders, and a first-contact email."),
    ("Sources", "Every URL used, one per row, linked to the lender ID."),
    ("Excluded & Watchlist", "Lenders researched and left out (acquired, wound down, no broker channel, out of scope), with the reason."),
    ("", None),
    ("HOW TO USE", None),
    ("1. Filter", "On Lenders, filter Category, Tier = A and Lends in CA = Yes. That is the first call list."),
    ("2. Apply", "Use 'Broker sign-up / broker page' when there is one; otherwise call or email the broker desk or the public contact."),
    ("3. Send the package", "Send the Account Setup package with each application, and use the email template for first contact."),
    ("4. Track", "Log every touch in the yellow columns: Status (dropdown), dates, next step, agreement signed, assigned rep."),
    ("5. Re-verify terms", "Rates, leverage and minimums change often. Treat them as a screen and confirm the current matrix with the lender before quoting a borrower."),
    ("", None),
    ("TIERS", None),
    ("A", "Documented broker channel, lends in California, and the product squarely fits. 'Documented' means a broker page, portal or fee-protection statement, or (for debt funds and banks that publish none) recent loans the lender closed that an outside intermediary arranged."),
    ("B", "Strong product fit, but one of those is unconfirmed (for example, broker channel implied but not published)."),
    ("C", "Niche, narrow geography, or only part of the program fits Corin."),
    ("", None),
    ("CONFIDENCE", None),
    ("High", "Terms and broker channel confirmed on the lender's own website or a 2025-26 lender release."),
    ("Medium", "A mix of the lender's site and third-party sources (trade press, Scotsman Guide, directories)."),
    ("Low", "Mostly third-party or older than 2024. Verify before relying on it."),
    ("", None),
    ("COLOUR KEY", None),
    ("Yellow cells, blue text", "Your inputs. Every other cell is research or a formula."),
    ("Blue underlined", "Clickable links."),
    ("Red next-step date", "The next-step date has passed and the lender is not yet approved or declined."),
    ("Blue 'Yes' in Existing", "Lender is already in Corin's routing table (lib/ai/lenders.ts): Vium, Greystone, Cambridge, Lument, Liberty SBF, Harvest SBF, Ready Capital, TMC Financing, Roc Capital, Fidelis."),
    ("", None),
    ("EXAMPLE TRACKER ENTRY", "Owner: J. Lee  |  Status: Application submitted  |  First contact: 2026-11-05  |  Last touch: 2026-11-07  |  "
     "Next step: Send W-9 and DRE license  |  Next step date: 2026-11-10  |  Agreement signed: Pending  |  Notes: Covers CA; 3-day term sheets on bridge"),
    ("", None),
    ("CAVEATS", None),
    ("Public sources only", "Everything here comes from lenders' websites, press releases and trade press. Blank means it was not published, not that it is zero. Nothing was guessed."),
    ("Contacts", "Named contacts are people the lender lists publicly in an originations or broker role. People move, so confirm before you reach out."),
    ("Not legal advice", "California licensing, MLDS and usury points on the Account Setup sheet summarise this repo's counsel research. A California attorney must confirm them."),
]
r = 4
for label, text in rows:
    if text is None and label:
        sh.cell(r, 2, label).font = font(bold=True, size=11, color=NAVY)
    elif label or text:
        a = sh.cell(r, 2, label)
        a.font = font(bold=True)
        a.alignment = WRAP_TOP
        b = sh.cell(r, 3, text)
        b.font = font()
        b.alignment = WRAP_TOP
        if label == "Yellow cells, blue text":
            a.fill = INPUT_FILL
            a.font = font(bold=True, color="0000FF")
        if label == "EXAMPLE TRACKER ENTRY":
            b.fill = INPUT_FILL
            b.font = font(color="0000FF")
        lines = -(-len(str(text)) // 105)
        if lines > 1:
            sh.row_dimensions[r].height = 14 * lines
    r += 1

# sheet order: Start Here, Dashboard, Lenders, Account Setup, Sources, Excluded
order = ["Start Here", "Dashboard", "Lenders", "Account Setup", "Sources", "Excluded & Watchlist"]
wb._sheets = [wb[n] for n in order]
wb.active = 0
for wsx in wb.worksheets:
    wsx.sheet_properties.tabColor = {"Start Here": NAVY, "Dashboard": "2E75B6", "Lenders": "548235",
                                     "Account Setup": "BF8F00", "Sources": "7F7F7F",
                                     "Excluded & Watchlist": "C00000"}[wsx.title]

ws.print_title_rows = "1:1"
ws.print_title_cols = "A:B"
ws.page_setup.orientation = "landscape"
ws.page_setup.paperSize = ws.PAPERSIZE_LEGAL
for wsx in (sh, db, acc):
    wsx.page_setup.orientation = "portrait" if wsx is sh else "landscape"
    wsx.sheet_properties.pageSetUpPr.fitToPage = True
    wsx.page_setup.fitToWidth = 1
    wsx.page_setup.fitToHeight = 0

OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)
print(json.dumps({
    "lenders": len(lenders),
    "by_category": {c: sum(1 for r in lenders if r["category"] == c) for c in CATEGORY_ORDER},
    "by_tier": {t: sum(1 for r in lenders if r["tier"] == t) for t in "ABC"},
    "excluded": len(seen_ex),
    "existing": sum(1 for r in lenders if r["_existing"] == "Yes"),
}, indent=1))
