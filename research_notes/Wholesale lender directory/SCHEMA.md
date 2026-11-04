# Lender research record schema (shared by all research agents)

Client context: Corin Commercial, Inc. is a California DRE-licensed commercial mortgage BROKER
(not a lender). It arranges senior living / healthcare (HUD 232, Bridge-to-HUD, SBA), hospitality,
multifamily / CRE, construction, and private bridge / hard money loans. It wants lenders
it can open broker / wholesale / correspondent accounts with, i.e. lenders that accept
deals from outside mortgage brokers and pay or protect broker compensation.
It already has relationships with: Vium Capital, Greystone, Cambridge Realty Capital, Lument,
Liberty SBF, Harvest SBF, Ready Capital, TMC Financing CDC, Roc Capital (Roc360), Fidelis Private Fund.
Still include these if they are in your scope; they get flagged as "existing" later.

Write a JSON file: {"lenders": [ ...records... ], "excluded": [ {"name": "", "reason": "", "source": ""} ]}

Each record (use null or "" when you could not find a value; NEVER guess or invent):

{
  "name": "Official lender name (brand), e.g. 'Lima One Capital'",
  "parent_or_aka": "Parent company / former name, e.g. 'MFA Financial subsidiary' or 'formerly Lancaster Pollard'",
  "category": "Construction" | "Hard Money / Bridge" | "Senior Living / Healthcare",
  "subcategory": "short label set by your scope (given in your brief)",
  "lender_type": "Bank" | "Debt fund" | "Private money fund" | "Non-bank lender" | "HUD/Agency lender" | "REIT" | "Insurance co." | "Specialty finance",
  "hq_city": "", "hq_state": "2-letter",
  "website": "https://...",
  "footprint": "e.g. 'National (48 states)', 'CA only', 'West: CA, OR, WA, AZ, NV'",
  "lends_in_california": "Yes" | "No" | "Unconfirmed",
  "property_types": "comma list, e.g. 'Multifamily, SFR 1-4, Mixed-use, Retail, Industrial, Self-storage, Hospitality, Senior housing (IL/AL/MC), SNF'",
  "programs": "comma list of loan products, e.g. 'Ground-up construction, Fix & flip, Bridge, DSCR rental, HUD 232/223(f), HUD 232 NC/SR, Fannie Mae Seniors Housing, Mezz'",
  "min_loan_usd": number or null,
  "max_loan_usd": number or null,
  "max_leverage": "e.g. '90% LTC / 75% ARV' or '80% LTV'",
  "rate_range": "as published, e.g. '9.99%-12.5%' or 'SOFR + 350-600'",
  "term": "e.g. '12-24 mo + extensions' or '35-40 yr fully amortizing'",
  "recourse": "e.g. 'Full recourse', 'Non-recourse', 'Non-recourse w/ carve-outs'",
  "lien_position": "e.g. '1st', '1st & 2nd', '1st, mezz, pref equity'",
  "speed_to_close": "as published, e.g. '5-10 days' or '120-180 days (HUD LEAN)'",
  "broker_program": "How they work with outside brokers: broker portal/wholesale channel, broker fee protection, broker points allowed (cap), YSP, closes in lender name, correspondent/referral fee-split, etc. Be specific, cite what their site says.",
  "broker_signup_url": "direct URL of the broker / partner application or broker page if one exists",
  "phone": "main or broker-desk phone as published",
  "email": "broker desk / general business email as published (no personal emails unless published by the company for business contact)",
  "address": "HQ street address as published",
  "contact_name": "only a person the company publicly lists in an originations / broker-relations / healthcare-lending role",
  "contact_title": "",
  "licenses": "e.g. 'CA DRE #01234567', 'CA CFL #60DBO-12345', 'NMLS #123456', 'HUD MAP/LEAN approved', 'Fannie Mae DUS', 'Freddie Mac Optigo Seniors Housing'",
  "fit_notes": "1-2 sentences: why this lender fits Corin (CA reach, product, size), plus any caveat",
  "tier": "A" | "B" | "C",
  "sources": ["every URL you actually used, lender site first"],
  "confidence": "High" | "Medium" | "Low",
  "last_verified": "YYYY-MM-DD (the date you checked)"
}

Tier rubric:
- A = documented broker/wholesale channel AND lends in California AND product squarely matches the subcategory.
- B = good product fit but one of the A elements is unconfirmed (e.g. broker channel implied but not documented, or CA lending unconfirmed).
- C = niche, narrow geography, or only partly relevant.

Confidence rubric:
- High = key terms and broker channel confirmed on the lender's own website (or a 2025-2026 press release from the lender).
- Medium = mixed: some from lender site, some from third-party sources (Scotsman Guide, trade press, directories).
- Low = mainly third-party or older than 2024.

Hard rules:
- Do not fabricate any value. Blank beats wrong. Phone numbers, emails, URLs and license numbers must be copied from a page you fetched.
- Check that the lender is still active in 2026 (mergers, wind-downs, rebrands). Acquired or defunct lenders go in "excluded" with the reason, or under the surviving brand.
- Numbers: min/max loan as plain integers in USD (e.g. 250000), not strings.
- Valid JSON only (no comments, no trailing commas). Validate it with `python3 -c "import json;json.load(open('PATH'))"` before you finish.
