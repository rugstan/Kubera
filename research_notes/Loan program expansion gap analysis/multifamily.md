# Multifamily Financing as a Business Line for Corin Commercial (products, underwriting artifacts, data/software stack, agent opportunities, CA specifics, gap list)

Research notes compiled 2026-10-31. Method note: direct page fetches mostly failed from this environment (newpoint.com and dwightcapital.com did not resolve). Almost every fact below comes from **web search result snippets/summaries**, not from reading the full page; these are marked "(snippet)". Items drawn from general domain knowledge rather than a source found in this session are labelled "[domain knowledge, unverified this session]" and are kept out of Cited Findings. Corin code references: `/home/user/Corin/lib/sizing/assumptions.ts` (lines 59-61 hold the HUD multifamily constants; line 115 the bridge `cre` box), `/home/user/Corin/lib/ai/knowledge.ts` (lines 13, 32-34 hold the advisor's HUD/agency facts).

## 1. Multifamily debt product menu and sizing rules (2026), and verification of Corin's sizer

### Takeaway
Several of Corin's HUD constants are **out of date**. HUD Mortgagee Letter 2025-03 (January 2025) raised market-rate 223(f)/221(d)(4) leverage to 87% at a 1.15x DSCR, and affordable or rental-assisted deals to 90% at 1.11x. A Federal Register notice (Sept 23, 2025) set the MIP at a flat 0.25% for all FHA multifamily programs, for applications submitted or amended on or after Oct 1, 2025, and removed the separate green and affordable MIP tiers. The agency 80% / 1.25x box matches Fannie Mae's small-loan term sheet (up to $9M). Freddie Mac reportedly retired its SBL program on April 15, 2026 in favour of a "Conventional Small" product ($2M-$10M, 50 units or fewer). That claim comes from lender sites only, so confirm it.

### Cited Findings

**HUD / FHA (223(f), 221(d)(4))**
- HUD Mortgagee Letter 2025-03 (effective about January 8, 2025, per secondary sources) changed market-rate 221(d)(4) and 223(f) from 1.176x DSCR / 85% LTC-LTV to **1.15x / 87%**. (snippet) — [Dwight Capital](https://dwightcapital.com/news/hud-announces-beneficial-changes-in-dscr-and-ltc-ltv-requirements-for-fha/); [NewPoint](https://newpoint.com/news/hud-announces-changes-dscr-and-ltcltv-requirements); HUD document listing dated January 16, 2025: [hud.gov 2025-06hsgml.pdf](https://www.hud.gov/sites/dfiles/OCHCO/documents/2025-06hsgml.pdf) (could not open; it may be a related ML rather than 2025-03).
- Affordable, broadly affordable and rental-assistance properties: **90% LTV, 1.11x DSCR**. (snippet) — [hud.loans 223(f)](https://www.hud.loans/fha-223f/); [CohnReznick](https://www.cohnreznick.com/insights/multifamily-housing-programs)
- One source says Mortgagee Letter 2026-1 extends the 1.11x / 90% thresholds to qualifying **middle-income 221(d)(4)** projects. (snippet, single source) — [adroccap.com](https://www.adroccap.com/trending)
- The changes do **not** apply to the health care (Section 232) programs. (snippet) — [hud.loans 223(f)](https://www.hud.loans/fha-223f/)
- The 223(f) cash-out limit is unchanged (CohnReznick: "no change to the current LTV ratio for cash out refinancing"). One summary gives it as the greater of 100% of transaction costs or 80% LTV. (snippet) — [CohnReznick](https://www.cohnreznick.com/insights/multifamily-housing-programs)
- Sizing is the lowest of the LTV, DSCR and statutory-limit tests. Only the DSCR test depends on the interest rate. (snippet) — [Roach Lorenz](https://roachlorenz.com/resources/how-hud-sizes-a-223f-mortgage/)
- One source reports that a market-rate 221(d)(4) requires 1.20x on stabilized NOI. This conflicts with the 1.15x above and is probably outdated or a lender overlay. (snippet) — [Janover 221(d)(4)](https://janover.pro/guides/hud-221d4-loan-for-new-construction)
- **MIP:** The Federal Register final notice 2025-18379 (Sept 23, 2025) sets the MIP for all FHA multifamily insurance programs at the 0.25% statutory minimum. It drops the 2016 green, affordable and broadly-affordable categories. It applies to applications submitted or amended on or after Oct 1, 2025, for loans not yet initially endorsed. It is not retroactive. — [Federal Register](https://www.federalregister.gov/documents/2025/09/23/2025-18379/changes-in-mortgage-insurance-premiums-applicable-to-fha-multifamily-insurance-programs); [Novogradac](https://www.novoco.com/news/hud-reduces-mips-to-025-for-fha-multifamily-insurance-programs); [NAA](https://naahq.org/news/hud-finalizes-changes-mortgage-insurance-premiums). Lument describes the trigger as loans *closed* on or after Oct 1, 2025, which conflicts with the FR text; the FR text controls — [Lument](https://www.lument.com/hud-reduces-mortgage-insurance-premium-mip-for-all-fha-multifamily-insurance-programs/)
- One secondary source states the result as 0.25% upfront at closing plus 0.25% annually. Older pages still show 1.00% upfront and 0.60% annual. (snippet) — search summary over [multifamily.loans HUD 223(f)](https://www.multifamily.loans/hud-223f-loans/) and [commercialrealestate.loans](https://www.commercialrealestate.loans/hud-223f-loans/)

**Fannie Mae**
- The official Fannie Mae multifamily small-loan term sheet (© 2026) gives loans **up to $9M nationwide**, 5-30 year terms, amortization up to 30 years, **80% max LTV, 1.25x min DSCR**, with supplemental financing available. (snippet) — [Fannie Mae term sheet](https://multifamily.fanniemae.com/media/37046/display)
- Secondary sources put the small-loan minimum at $750K or $1M (conflicting). One source cites 75% LTV for refinances, which is unverified. — [multifamily.loans](https://www.multifamily.loans/fannie-mae-multifamily-small-loans/); [Janover](https://janover.pro/guides/fannie-mae-small-balance-loan)
- Indicative small-loan pricing: one lender page shows 7.49%-7.69% for the 80% / 1.25x tier (updated Oct 28, 2026); another shows 6.10%-8.20% (Aug 2026). These are lender marketing pages. (snippet) — [multifamily.loans](https://www.multifamily.loans/fannie-mae-multifamily-small-loans/); [crowdfundedwealth](https://www.crowdfundedwealth.com/articles/multifamily-loan-rates-2026)
- **Green Rewards:** Fannie's page lists lower pricing, additional loan proceeds and a free energy and water audit. Secondary sources say the extra proceeds come from up to ~5% of projected utility savings (exact mechanics unclear). Eligible loans are first liens, supplementals and second supplementals (all second-supplemental proceeds must fund green improvements). The improvements must cut whole-property energy or water use by 30% or more. One source cites a 0.10% rate discount; that is unverified, and the Greystone term sheet is from 2020. — [Fannie Mae Green Rewards](https://multifamily.fanniemae.com/financing-options/specialty-financing/green-financing/green-rewards); [Greystone 2020 term sheet](https://www.greystone.com/wp-content/uploads/2020/06/Greystone-Fannie-Mae-Green-Rewards-Loan-Term-Sheet.pdf); [LSG](https://www.lsglending.com/fannie-mae-green-rewards/)
- The Multifamily Selling & Servicing Guide is effective as of April 3, 2026 (DUS Gateway release for credit facility refinances). — [mfguide.fanniemae.com](https://mfguide.fanniemae.com/system/files/03-26-26-04-00-58-PM/DUS%20Gateway%20Release%20for%20Credit%20Facility%20Refinances%20and%20Conversions%20(Redline).pdf)
- DUS lenders underwrite, close and service under delegated authority and typically keep about one-third of the risk on each loan. Borrowers reach Fannie only through these lenders. — [J.P. Morgan](https://www.jpmorgan.com/insights/real-estate/agency-lending/what-is-a-dus-lender); [Fannie Mae DUS overview](https://capitalmarkets.fanniemae.com/media/dus-program-overview)

**Freddie Mac Optigo**
- **Program change (needs confirmation):** Lender and broker sites say Freddie retired the SBL program on **April 15, 2026** and moved small-balance lending into **"Conventional Small"**: $2M-$10M, up to 80% LTV, 1.25x DCR, 50 units or fewer. They also say Freddie no longer does small balance below $2M. No Freddie-hosted confirmation was found. (snippet) — [multifamily.loans Freddie SBL](https://www.multifamily.loans/freddie-mac-small-balance-apartment-loans/); [commercialrealestate.loans](https://www.commercialrealestate.loans/freddie-mac-loans/)
- Legacy SBL terms (pre-April 2026; mark **older**): $1M-$7.5M ($6M in small and very small markets). LTV 80% in top and standard markets, 75% purchase / 70% refi in small and very small markets. Min DSCR 1.20x top / 1.25x standard / 1.30x small / 1.40x very small. Carve-out waiver at 1.40x / 65%. — [apartment.loans](https://apartment.loans/freddie-mac-small-balance-loans/); [Optigo SBL program sheet (old)](https://www.multifamilycap.com/hubfs/Optigo%20small_balance_loan%20program%20sheet.pdf?hsLang=en)
- Freddie value-add product (as reported): as-is max 85% LTV, plus an as-stabilized test of 75% LTV / 1.30x. (snippet) — [yieldstack bridge LTV](https://yieldstack.ai/blog/multifamily-bridge-loan-ltv)

**GSE capacity 2026**
- FHFA set the 2026 caps at **$88B each** for Fannie and Freddie ($176B combined), up about 20.5% from $73B. At least 50% must be mission-driven. Workforce-housing loans are excluded from the caps. FHFA can raise the caps and will not lower them. — [FHFA](https://www.fhfa.gov/news/news-release/u.s.-federal-housing-announces-2026-multifamily-loan-purchase-caps-for-fannie-mae-and-freddie-mac); [NAHB](https://www.nahb.org/blog/2025/11/fannie-freddie-multifamily-loan-purchases); [ABA Banking Journal](https://bankingjournal.aba.com/2025/11/fhfa-sets-2026-multifamily-loan-purchase-caps-for-fannie-freddie/)

**Bridge (light and heavy value-add)**
- Rates: 9.0-10.5% all-in (May 2026, one guide). Small-deal rates are about 9.49%-11.75% fixed IO; middle-market floaters are SOFR + 325-475 bps. (snippet, lender marketing) — [yieldstack](https://yieldstack.ai/blog/multifamily-bridge-loan-ltv); [requitygroup](https://requitygroup.com/insights/multifamily-bridge-loans-guide/)
- LTV: institutional lenders typically go to 65-75% of as-is value, with a ceiling of 75-80%. With a renovation holdback, some reach 85-90% LTC. Middle-market exit test: 1.25x DSCR and a 9.5-10.5% stabilized debt yield. (snippet) — [yieldstack](https://yieldstack.ai/blog/multifamily-bridge-loan-ltv); [bridgeloan-financing.com](https://bridgeloan-financing.com/multifamily-bridge-loans-guide/)
- Market benchmark (CBRE Q2 2026, via a secondary source): average multifamily LTV 63.3% (65.8% a year earlier), average DSCR 1.43 (1.34), average debt yield 10.2% (9.7%). (snippet; not checked against CBRE) — [yieldstack](https://yieldstack.ai/blog/multifamily-bridge-loan-ltv)

**DSCR investor loans (2-4 and 5+ units)**
- 5+ units: max LTV typically 70-75% (5-10 units: 75% purchase / 70% cash-out); some "rigid commercial" programs go to 65-70%. Min DSCR runs 1.00x-1.20x at private lenders and 1.15x-1.25x elsewhere. FICO floors are around 680-700. Some lenders require one prior 5+ unit property or three completed 1-4 unit deals. (snippet, lender blogs) — [dscrcapitalpartners](https://dscrcapitalpartners.com/blog/dscr-ltv-limits/); [yieldstack DSCR](https://yieldstack.ai/blog/dscr-loan-requirements-2026); [mmclending](https://mmclending.com/blog/5-8-unit-multifamily-dscr-loans)

**Broker compensation**
- On referrals to DUS or Optigo lenders, brokers typically negotiate **0.50%-0.75%**, paid by the lender out of its origination margin. A borrower-paid alternative runs 0.75%-1.50%. Another source gives 0.50%-1.00%, paid only at closing. Some DUS lenders do not work with brokers. (snippet, third-party guides) — [Janover fee structures](https://janover.pro/guides/broker-fee-structures); [yieldstack](https://yieldstack.ai/blog/agency-multifamily-loans-approved-lenders)
- Example DUS lender cost: $5,000 processing fee (Regions flyer). — [Regions](https://www.regions.com/-/media/pdfs/real-estate-banking/FannieDUSFlyer.pdf)

### Inferences
- **Corrections to Corin's sizer** (`lib/sizing/assumptions.ts` L59-61, `lib/ai/knowledge.ts` L13, L32-33):
  - `s223f`: maxLtv 0.85 → **0.87**; minDscr 1.176 → **1.15**; maxLtvAffordable 0.87 → **0.90**; minDscrAffordable 1.15 → **1.11**. Add a rental-assistance flag; it uses the same 90% / 1.11x box.
  - `s221d4`: maxLtc 0.85 → **0.87**; minDscr 1.176 → **1.15**; affordable → **0.90 / 1.11**.
  - `mip`: replace all tiers with **0.25% annual** for applications on or after Oct 1, 2025. The upfront (first-year) premium should also be 0.25%; that figure comes from a secondary source, so confirm with a HUD lender. Remove the "green" MIP benefit as a differentiator; green status is no longer a MIP lever.
  - `knowledge.ts` L13 ("upfront MIP ~1%, annual ~0.65%") and L33 are stale, so the AI advisor will mis-quote costs.
  - The ML 2025-03 changes exclude Section 232, so Corin's 232 constants (L48-50) are unaffected by the DSCR/LTV change. Whether the Sept 2025 MIP notice covers 232 is a separate question; see Gaps.
- **Agency box:** 80% / 1.25x / up to 30-yr amortization is correct as a *maximum* for Fannie small loans. Real deals in 2026 are mostly DSCR-constrained; the CBRE average LTV is about 63%. The sizer should run tiered DSCR/LTV grids (Fannie conventional tiers; Freddie market tiers), not one box. The "10-yr term" should become selectable 5/7/10/12. [Fannie conventional tier grids: domain knowledge, unverified this session]
- **Bridge box:** 75% LTV fits the as-is ceiling. A 7% going-in debt-yield floor is not contradicted, but no source confirmed it. Lenders more often gate bridge loans on an *exit* test (stabilized DY 9.5-10.5% and 1.25x at a takeout rate). Add an exit/takeout test that sizes against a Fannie/Freddie/HUD refinance.
- **Freddie product list:** If the SBL retirement is real, Corin's agency copy should say "Freddie Conventional Small ($2M-$10M)". Sub-$2M deals then go to Fannie Small (≥$750K-$1M), bank/CU portfolio lenders or DSCR lenders.
- **Prepayment, recourse and timelines** by product [domain knowledge, unverified this session]:
  - Agency fixed: yield maintenance or defeasance; ARMs carry a 1% step-down.
  - SBL/small loans: step-down schedules (e.g. 5-4-3-2-1).
  - HUD: typically a 10-year declining prepay (e.g. 10% falling 1% a year), negotiable.
  - CMBS: defeasance.
  - Bank: step-down.
  - Bridge: 12-18 month minimum interest.
  - Agency, HUD, CMBS and life companies are non-recourse with carve-outs; banks often require full or partial recourse.

### Gaps
- No primary-source 2026 data found for: Fannie conventional DUS tier grids, MAH/affordable terms, or supplemental-loan sizing rules; the Freddie Targeted Affordable (TAH) term sheet; HUD **223(a)(7)** terms (no search results); LIHTC 4% bond and Fannie/Freddie forward-commitment terms; bank and credit-union portfolio terms; life-company multifamily terms; CMBS multifamily terms (two searches returned none). These remain unverified and should not be hard-coded without lender term sheets.
- Fannie/Freddie **correspondent-lender origination splits** (how a DUS origination fee is shared with a correspondent or broker): no source found.
- Whether FR 2025-18379's 0.25% MIP applies to Section 232 healthcare loans is not confirmed. SAHMA and Lument say "all FHA multifamily insurance programs". Corin's 232 MIP (0.65% / 0.77%) should be re-checked.
- No Freddie Mac primary confirmation of the SBL retirement or the Conventional Small terms.
- HUD timeline (LEAN 120-180 days in `knowledge.ts`) is unverified this session.

## 2. Underwriting artifacts by lender type, how they are produced, and what can be pulled automatically

### Takeaway
The lender package is the same across programs: rent roll, T-12 (often annualized T-3 income against T-12 expenses), rent and sales comps, expense benchmarks, a re-assessed tax line, insurance quote, reserves/PCA, and a sponsor REO schedule with PFS. Programs differ mainly in which haircuts they apply. Only comps, benchmarks, tax rates, parcel/ownership data and rent-control status can be pulled automatically. The rent roll, T-12, insurance quote and sponsor financials must come from the borrower, then be extracted and normalized.

### Cited Findings
- Clik.ai spreads T-12s, rent rolls and operating statements from PDF, Excel, Word or scanned files. It claims >99% / 99.9% accuracy (vendor claims). — [Clik.ai auto-underwriting](https://clik.ai/product/auto-underwriting); [aiforproptech](https://aiforproptech.com/companies/clik-ai/)
- HelloData offers a Rent Comp Detection API, an **Expense Benchmarks API**, a QualityScore API and a LiquidRent API. Its broker page says the API brings real-time rent and expense comps into models. — [HelloData help](https://www.hellodata.ai/help-articles/what-apartment-data-does-hellodata-provide); [HelloData brokers](https://www.hellodata.ai/customers/real-estate-brokers)
- HUD sizing uses the lowest of the LTV, DSCR and statutory tests. The statutory and LTV tests are rate-independent. — [Roach Lorenz](https://roachlorenz.com/resources/how-hud-sizes-a-223f-mortgage/)
- Agency lenders size to the tighter of the LTV and DSCR constraints. — [Janover Fannie small](https://janover.pro/guides/fannie-mae-small-balance-loan)

### Inferences
Artifact → source → automation potential [domain knowledge, unverified this session except where cited above]:

| Artifact | Lender use | Produced by | Auto-pull? |
|---|---|---|---|
| Rent roll (unit mix, sq ft, in-place vs market rent, lease dates, concessions, delinquency, vacancy, loss-to-lease) | All; agency/HUD require a certified current rent roll; HUD/agency check occupancy history | Borrower PMS export (Yardi/RealPage/AppFolio/Entrata) | No. Extract with LLM/OCR, normalize unit types, compute LTL, concessions and economic occupancy |
| T-12 operating statement; T-3 or T-1 annualized income | Agency often uses the lower of T-3 annualized and T-12 income; HUD uses historicals and stabilized | Borrower accounting | No. Extract and map to a standard chart of accounts |
| Rent comps | Appraisal support; market-rent mark-to-market; bridge business plan | HelloData, Rentometer, Yardi Matrix, CoStar | **Yes** (API) |
| Sales comps / cap rates | LTV value; bridge as-is and as-stabilized value | CoStar/Reonomy/ATTOM deed records; brokers | Partial (ATTOM/Reonomy deed transfers; cap rates not in public records) |
| Expense benchmarks (per unit: payroll, R&M, utilities, insurance, admin) | Lender "underwritten" expenses floor actuals at benchmarks | HelloData Expense Benchmarks API; lender internal data; NAA/IREM survey | **Yes** (HelloData) |
| Real-estate tax re-assessment (CA Prop 13: purchase price × ~1% + voter-approved debt + direct assessments/Mello-Roos) | All acquisitions | County assessor/treasurer tax-rate-area tables | **Yes** (compute) |
| Insurance | Agency/HUD scrutinize increases heavily (CA wildfire/earthquake) | Broker quote | No (quote); benchmark via HelloData |
| Replacement reserves / capex; PCA | Agency per-unit minimum reserve, set by PCA; HUD PCNA | Third-party PCA vendor | No (order via vendor) |
| Appraisal, Phase I ESA, seismic PML (CA), zoning report | All agency/HUD/CMBS; seismic critical in CA | Third-party vendors, lender-engaged | No (order/track) |
| Sponsor: REO schedule, PFS, liquidity and net-worth tests (agency rule of thumb: net worth ≥ loan, liquidity ≈ 9-12 months P&I), credit, OFAC, experience | All | Borrower; credit/OFAC vendors | Partial (OFAC/KYC API; REO verification via ownership data) |
| Rent-control status per unit | CA lenders haircut growth assumptions | City/State rules + parcel year-built | **Yes** (rules engine + parcel data) |

### Gaps
- No primary-source agency or HUD document found this session listing exact required artifacts: the Fannie Small Loan checklist, Freddie Conventional Small checklist, the HUD MAP Guide Chapter 5 exhibit list, and T-3 vs T-12 income rules. Agency sponsor net-worth and liquidity tests are not sourced.
- No benchmark source found for CA insurance cost per unit in 2026.

## 3. Data providers and software for multifamily brokers: features, APIs, prices

### Takeaway
Most CRE data vendors do not publish prices; every figure below comes from third-party reviews and should be treated as a rough estimate. For an AI-agent broker, the cost-effective stack is a rent/expense comps API (HelloData; Rentometer for small assets), a parcel/ownership/tax API (Regrid or ATTOM), and in-house LLM extraction. CoStar, Yardi Matrix and Reonomy are enterprise-priced. Fannie and Freddie lender portals cannot be accessed by a broker.

### Cited Findings

**Rent-roll / T-12 extraction**
- **Clik.ai:** custom-quote subscription. A structured-data snippet showed $449/mo; no other source supports it. Offers a REST JSON API and a white-label widget, plus Excel, add-in and Salesforce outputs. No public API docs were found. Aimed at institutions and lenders; sales-led. — [Clik.ai](https://clik.ai/product/auto-underwriting); [cresoftware.tech](https://cresoftware.tech/products/clik-ai/); [nextautomation](https://nextautomation.us/compare/clik-ai-alternative); [aiforproptech](https://aiforproptech.com/companies/clik-ai/)
- Docsumo publishes a 2026 comparison of 10 CRE underwriting tools (vendor-authored). — [Docsumo](https://www.docsumo.com/blog/best-cre-automation-tools)

**Rent comps / multifamily data**
- **HelloData:** listings show a UI plan at $250/user/mo and an API at "$5 usage-based" (Software Advice), or a Professional plan at $300/user/mo with a 7-day trial (Toolmage). These conflict. APIs: Rent Comp, Expense Benchmarks, QualityScore, LiquidRent. Coverage claim: about 800K units collected daily via RentSource (conflicting figures). — [HelloData help](https://www.hellodata.ai/help-articles/what-apartment-data-does-hellodata-provide); [G2](https://ai.g2.com/marketplace/tools/hellodata); [toolmage](https://www.toolmage.com/en/tool/hellodata/)
- **Rentometer:** Pro is $29/mo or $199/yr and includes API access. Older API pages (about 3 years old) list credit packs from 1,000 credits for $99 to 20,000 for $799, at one credit per estimate. Team and Enterprise API are quoted separately. — [Rentometer pricing](https://www.rentometer.com/pricing/individual); [Rentometer API](https://www.rentometer.com/rentometer-api); [API pre-sale PDF (older)](https://cms.rentometer.com/wp-content/themes/rentometer/assets/files/API-Pre-sale.pdf)
- **Yardi Matrix:** no public pricing; requires a sales call and demo. — [TrustRadius](https://www.trustradius.com/products/yardi-matrix/pricing)
- **CoStar:** Vendr median about $40K/yr for one license (up to 3 users) against about $71K list. Other estimates: average about $15K/yr, or $1,200-4,000/user/mo (conflicting). Customized by users, modules and geography. — [motioncre](https://motioncre.com/resources/costar-alternatives); [morainecre](https://morainecre.com/software/vs/costar-vs-yardi-matrix); [plumlending](https://plumlending.com/insights/costar-review-commercial-real-estate-data-giant)
- **CompStak:** estimates range from $499/yr DIY to $20K-$50K+/yr enterprise (irreconcilable). — [credaily](https://www.credaily.com/reviews/best-commercial-real-estate-data-sources/); [forage.ai](https://forage.ai/blog/commercial-real-estate-data-tools/)

**Property, ownership and parcel data**
- **Regrid:** Pro app $10/mo or $100/yr. A self-serve API card shows about $375-$500/mo for 2,000 parcel records plus tiles. API and nationwide bulk licences run about $12K-$25K+/yr. — [scoutdata](https://scoutdata.com/guides/regrid-pricing); [forage.ai](https://forage.ai/blog/real-estate-api-pricing/)
- **ATTOM:** no public API rate card. Property Navigator Professional is $499/yr per user. Third-party API estimates run $850-$2,000/mo, or about $1,000/mo for 10K calls on an annual contract. The commonly quoted "$95/mo" is likely a misreading. — [marketintelligencetools ATTOM](https://marketintelligencetools.com/reports/attom-data-pricing/); [homesage](https://homesage.ai/resources/blog/homesage-ai-or-attom-data-when-to-use-each-real-estate-api/)
- **Reonomy:** no printed price; annual billing saves 30% and includes 1,000 exports/mo. Estimates are about $400/user/mo; an older page shows $399-$1,197/mo. The API needs a contract. — [marketintelligencetools Reonomy](https://marketintelligencetools.com/reports/reonomy-pricing/); [nextautomation](https://nextautomation.us/blog/reonomy-alternatives)

**CRE CRMs**
- **Buildout:** about $600-1,200/mo firmwide (estimate). No sourced Apto price; one stack example lists "$2,500" without basis. — [miopsai](https://miopsai.io/blog/industries/commercial-real-estate-tech-stack-2026)

**Agency portals**
- Borrowers reach Fannie only through DUS lenders, who underwrite and deliver under delegated authority. The DUS Gateway is referenced in the April 2026 Guide release as a lender-side system. — [J.P. Morgan](https://www.jpmorgan.com/insights/real-estate/agency-lending/what-is-a-dus-lender); [Fannie Guide release](https://mfguide.fanniemae.com/system/files/03-26-26-04-00-58-PM/DUS%20Gateway%20Release%20for%20Credit%20Facility%20Refinances%20and%20Conversions%20(Redline).pdf)

### Inferences
- A broker cannot access DUS Gateway, Freddie's lender systems or HUD's lender portals; those are seller/servicer-only [domain knowledge]. Corin's value is producing a lender-ready package that DUS/Optigo/MAP lenders ingest, not portal integration. The public Fannie/Freddie term sheets, Guide and MBS disclosure data (Fannie DUS Disclose, Freddie Multifamily securities data) are usable for comps and maturity data [domain knowledge, unverified this session].
- Corin already plans Claude plus NeMo Retriever extraction. Building rent-roll and T-12 extraction in-house is feasible and avoids Clik.ai's opaque, institution-priced contracts. Clik.ai or Docsumo would be a fallback for scanned or ugly files.
- Lowest-cost credible comps stack: HelloData API (rent + expense benchmarks) plus Rentometer (credits, small 2-4 / 5-20 unit assets). Defer CoStar, Yardi Matrix and CompStak unless deal volume justifies $15K-$40K+/yr.
- Ownership, maturity and prospecting: Regrid (parcel, owner, year built, units, cheap API) plus ATTOM or Reonomy (deed, mortgage recordings, lender, origination date; loan maturity is inferred from origination plus a typical term) is enough to build a refinance-maturity prospecting list.
- Bowery (appraisal software for appraisers) and Cherre (enterprise data-integration platform) are not broker-relevant at Corin's scale [domain knowledge; no pricing found].

### Gaps
- No vendor-published prices found for HelloData, CoStar, Yardi Matrix, RealPage/Axiometrics, CompStak, Cherre, Bowery, Blooma, RealQuant, Ocrolus-for-CRE, Apto or Buildout. Blooma, RealQuant, Ocrolus-CRE, Docsumo pricing and API features, and Zillow / Apartment List API availability were **not researched** (call budget).
- No source found on loan-maturity datasets (Trepp, MBA, ATTOM mortgage) or their pricing.

## 4. Agentic opportunities: multifamily tasks Corin's agents could automate, and the data each needs

### Takeaway
The highest-value automations are rent-roll/T-12 normalization into an underwritten NOI, a multi-program quote matrix that sizes each program at the binding constraint, a CA tax re-assessment and rent-control engine, and refinance prospecting from recorded-mortgage data. All of them can run behind Corin's planned broker approval gate.

### Cited Findings
- Comp and expense data APIs exist for direct model integration: HelloData Rent Comp and Expense Benchmarks APIs; Rentometer API. — [HelloData](https://www.hellodata.ai/help-articles/what-apartment-data-does-hellodata-provide); [Rentometer API](https://www.rentometer.com/rentometer-api)
- Clik.ai-style document spreading (T-12s, rent rolls, operating statements from PDF, Excel or scans) is an established commercial category. — [Clik.ai](https://clik.ai/product/auto-underwriting)
- Program sizing is a deterministic min() of LTV, DSCR and statutory tests, which suits a rules engine. — [Roach Lorenz](https://roachlorenz.com/resources/how-hud-sizes-a-223f-mortgage/)
- 2026 agency capacity is large ($88B each) and workforce housing is cap-exempt, which supports prospecting for agency refinances. — [FHFA](https://www.fhfa.gov/news/news-release/u.s.-federal-housing-announces-2026-multifamily-loan-purchase-caps-for-fannie-mae-and-freddie-mac)

### Inferences
| Agent task | Inputs/data | Notes |
|---|---|---|
| Rent-roll normalization (unit-type mapping, LTL, concessions, delinquency, occupancy, lease expiry ladder, rent-control flag per unit) | Borrower rent roll; HelloData market rents; parcel year built | Build on Claude extraction + schema validation; human check on totals |
| T-12/T-3 annualization → underwritten NOI with lender-style haircuts (vacancy floor, mgmt fee floor, reserves/unit, tax re-assessment, insurance) | T-12, rent roll, expense benchmarks, county tax rates | Feed "Jev" rules engine |
| Quote matrix across HUD 223(f)/(a)(7)/221(d)(4), Fannie Small/DUS, Freddie Conventional Small, bank, bridge, DSCR | Rate indices (UST, SOFR), program boxes, spreads (lender-sourced) | Show binding constraint per program, proceeds, all-in cost incl. MIP, prepay type, timeline |
| Comp pull + market memo | HelloData / Rentometer; ATTOM/Regrid sales | Auto-generate the lender package narrative |
| CA tax re-assessment estimate | Purchase price, county TRA rate (1% base + voter debt), direct assessments | Deterministic |
| Rent-control classification | Address → city; year built / CofO; unit count; owner type | AB 1482, Costa-Hawkins, LA RSO, SF etc. |
| Refinance prospecting from maturity data | Recorded mortgages (ATTOM/Reonomy), owner contacts, parcel units | Compliance: outbound via approval gate, TCPA/CAN-SPAM |
| Document chasing / conditions tracker by program checklist | Program checklists | Already planned |
| Third-party report ordering (appraisal, PCA, Phase I, seismic) | Vendor list | Agency/HUD lenders often engage these themselves; the agent tracks rather than orders |
| Sponsor REO verification | REO schedule × ownership data | Cross-check claimed experience |

### Gaps
- No published evidence of brokers' realized time savings from these automations was found.

## 5. California specifics: rent control, Prop 13, SB 9/SB 330

### Takeaway
California underwriting must model (a) the AB 1482 cap: 5% + regional CPI, max 10%; LA's figure is 8.7% for Aug 2026-Jul 2027. It exempts buildings with a CofO under 15 years old (rolling) and most single-family homes and condos not owned by corporate entities. (b) Stricter local caps: LA RSO is 3% for Jul 2026-Jun 2027; unincorporated LA County is about 1.919%. (c) Prop 13 re-assessment of the tax base to purchase price on acquisition. SB 9/SB 330 were not researched this session.

### Cited Findings
- AB 1482 cap = 5% + regional CPI, capped at 10%. LA-area cap is **8.7%** for increases effective Aug 1, 2026-Jul 31, 2027 (LA CPI 3.7%). One site gives 8.8% (3.8% CPI), which conflicts. — [Nourmand](https://nourmand.com/blog/ab-1482-rent-increases-in-2026-what-la-landlords-can-actually-charge); [thegroupcre](https://www.thegroupcre.com/post/ab-1482-rent-increase-limits-los-angeles); [Davidovich Stone](https://davidovichlaw.com/ab-1482-rent-increase-cap-updated-for-2026-what-california-property-owners-should-know/); conflicting: [rentceiling](https://rentceiling.com/california)
- **City of LA RSO:** 3% allowable increase Jul 1, 2026-Jun 30, 2027 (LAHD bulletin as cited by secondary sources). The RSO formula was reportedly overhauled in Feb 2026, and utility add-ons are no longer allowed. — [financialsupportresources](https://www.financialsupportresources.com/post/los-angeles-rent-increase-rules-rso-3-percent-ab-1482-cap-notice-2026-27); [rentpost](https://rentpost.com/resources/article/raise-rent-laws-in-los-angeles/)
- **Unincorporated LA County:** 1.919% max for Jul 2026-Jun 2027. (snippet) — [lametrohomefinder](https://www.lametrohomefinder.com/blog/los-angeles-rent-increase-rules)
- AB 1482 exempts housing with a CofO issued within the prior **15 years**, on a rolling basis. Single-family homes and condos are exempt unless owned by a corporation, REIT or LLC with a corporate member, and only if the owner gives written notice. — [Greenberg Traurig](https://www.gtlaw.com/-/media/files/insights/alerts/2019/10/gt-alert_ab-1482--tenant-protection-act-summary-of-key-provisions.ashx); [Nat Law Review](https://natlawreview.com/node/118238/printable/pdf)
- **Costa-Hawkins** bars local rent control on single-family homes, condos and units with a CofO in the last 15 years, and allows vacancy decontrol. — [costa-hawkins.com](https://costa-hawkins.com/ab-1482/); [AAGLA/CalRHA fact sheet](https://aagla.org/wp-content/uploads/2019/10/AB-1482-CalRHA-Fact-Sheet.pdf)
- One secondary source says AB 1482 sunsets **Jan 1, 2030** (unverified against statute). — [gocodebook](https://gocodebook.com/guides/rent-control-and-tenant-protections/ab1482-costa-hawkins-underwriting)

### Inferences
- In underwriting, the rent-growth and mark-to-market assumptions in a bridge business plan must be capped per unit by the governing regime: local ordinance if covered, otherwise AB 1482, otherwise exempt. LA RSO buildings (generally CofO before Oct 1978 [domain knowledge]) are limited to 3% in-place increases. Upside there comes only from vacancy decontrol on turnover, which is permitted under Costa-Hawkins.
- **Prop 13** [domain knowledge, unverified this session]: on a change of ownership the assessed value resets to purchase price. The tax is about a 1% base plus voter-approved debt (total commonly ~1.1-1.25% depending on tax rate area), plus direct assessments and Mello-Roos, with assessed value growth capped at 2%/yr thereafter. Lenders underwrite taxes on the *re-assessed* value for acquisitions, so seller-reported T-12 taxes understate post-sale cost on long-held assets.
- Seismic risk (PML studies, soft-story retrofit ordinances in LA and SF) and wildfire insurance are CA-specific underwriting items [domain knowledge].

### Gaps
- **SB 9 and SB 330 underwriting implications were not researched** (call budget). SB 330 (Housing Crisis Act) unit-replacement and protected-unit rules and SB 9 lot-split/duplex rules mainly affect redevelopment and construction deals. Treat this as open.
- San Francisco Rent Ordinance 2026 allowable increase, and other CA city ordinances (Oakland, Berkeley, Santa Monica, West Hollywood, San Jose, etc.): not researched.
- HCD statewide rent-control pages not reached; no CA DOJ AB 1482 publication fetched.
- Prop 13 mechanics unsourced this session.

## 6. Capabilities Corin Commercial is missing for multifamily (build / integrate / skip)

### Takeaway
The most urgent gap is that Corin's HUD multifamily constants and MIP are wrong for 2026 (pre-2025 values), which mis-sizes every HUD quote and overstates costs. After that, the biggest gaps are: no rent-roll/T-12 normalization into underwritten NOI, no comps or tax/rent-control data, single-box agency and bridge sizing with no exit test, and no maturity-based prospecting.

### Cited Findings
- HUD market-rate is now 87% / 1.15x, affordable 90% / 1.11x; MIP is a flat 0.25% (apps on or after Oct 1, 2025). — [hud.loans](https://www.hud.loans/fha-223f/); [Federal Register 2025-18379](https://www.federalregister.gov/documents/2025/09/23/2025-18379/changes-in-mortgage-insurance-premiums-applicable-to-fha-multifamily-insurance-programs)
- Corin's current values: `s223f` 0.85 / 1.176 (0.87 / 1.15 affordable); `mip` 0.006 / 0.0065 / 0.0035 / 0.0025 — `/home/user/Corin/lib/sizing/assumptions.ts` L59-61 (read this session).
- Freddie SBL reportedly replaced by Conventional Small ($2M-$10M). — [multifamily.loans](https://www.multifamily.loans/freddie-mac-small-balance-apartment-loans/)

### Inferences
Priority, tag and rationale for each capability:

1. **Fix HUD sizing constants and MIP** (223(f), 221(d)(4), affordable/rental-assistance flag, 0.25% MIP, drop the green MIP lever; update the advisor knowledge text). **BUILD** (config change). P0.
2. **Add HUD 223(a)(7)** refinance-of-HUD path; **verify terms first**. **BUILD**. P1.
3. **Tiered agency sizing:** Fannie Small (≤$9M) and conventional tiers, Freddie Conventional Small ($2M-$10M) and market tiers, selectable 5/7/10/12-yr terms, IO periods, supplemental loans, Green Rewards proceeds, prepay type. **BUILD**. P1.
4. **Bridge exit/takeout test** (stabilized DY 9.5-10.5% and 1.25x at a takeout rate; as-is vs as-stabilized; LTC with holdback) plus a light vs heavy value-add split. **BUILD**. P1.
5. **DSCR investor box** for 2-4 and 5+ units (70-75% LTV, 1.0-1.25x, FICO, experience), a natural on-ramp to the planned hard-money line. **BUILD** (program box) + lender panel. P1.
6. **Rent-roll and T-12 extraction plus normalization** (unit-mix, LTL, concessions, delinquency, T-3 annualization, chart-of-accounts mapping). **BUILD** on the planned Claude/NeMo extraction agent; keep Clik.ai/Docsumo as an optional **INTEGRATE** fallback for scanned files. P0.
7. **Underwritten-NOI engine** with lender-style haircuts (vacancy/credit-loss floors, management-fee floor, reserves/unit, expense benchmark floors, re-assessed taxes, insurance) feeding Jev. **BUILD**. P0.
8. **Rent comps and expense benchmarks.** **INTEGRATE** the HelloData API (rent comps + expense benchmarks) and Rentometer (credit-based, small assets). P1.
9. **Sales comps / cap rates.** **INTEGRATE** ATTOM deed data (sales prices) for basic comps. **SKIP** CoStar, Yardi Matrix and CompStak until volume justifies $15K-$40K+/yr. P2.
10. **Parcel, ownership and year-built data** (rent-control classification, REO verification, prospecting). **INTEGRATE** Regrid (cheap API) and/or ATTOM. P1.
11. **Refinance-maturity prospecting** (recorded mortgages → estimated maturity → owner outreach through the approval gate). **INTEGRATE** ATTOM or Reonomy mortgage data + **BUILD** the scoring and outreach workflow (Inngest). P2.
12. **CA property-tax re-assessment estimator** (Prop 13; county tax-rate-area tables, direct assessments, Mello-Roos). **BUILD**. P1.
13. **CA rent-control rules engine** (AB 1482 annual cap by CPI region, 15-yr rolling exemption, Costa-Hawkins, LA RSO 3%, LA County, SF and other cities; per-unit cap applied to rent-growth assumptions). **BUILD** (table-driven, updated yearly). P1.
14. **Multi-program quote matrix** (binding constraint, proceeds, all-in cost incl. MIP and fees, prepay, recourse, timeline) across HUD/agency/bank/bridge/DSCR, with live UST/SOFR indices. **BUILD** (extends the planned lender-matching agent). P0.
15. **Lender panel database** with program boxes, states, minimum and maximum size, broker-friendliness (some DUS lenders refuse brokers), and fee-split terms. **BUILD**. P1.
16. **Broker fee agreements / fee ledger** covering lender-paid (0.50-0.75%) vs borrower-paid (0.75-1.50%) structures, with CA DRE disclosure handling. **BUILD** (extends the planned fee ledger). P1.
17. **Sponsor/guarantor module** (REO schedule, PFS, liquidity and net-worth tests, OFAC). Already planned; **BUILD** + **INTEGRATE** a KYC/OFAC API. P1.
18. **Third-party report tracker** (appraisal, PCA/PCNA, Phase I, seismic PML, zoning). **BUILD** tracking in the vendor-order agent; usually lender-engaged. P2.
19. **Fannie/Freddie/HUD lender portals.** **SKIP**; brokers have no access. Produce lender-ready packages instead.
20. **Apto / Buildout CRE CRM.** **SKIP**; Twenty CRM covers this.
21. **Bowery, Cherre.** **SKIP** (appraiser and enterprise data platforms).
22. **LIHTC / 4% bond structuring, Freddie TAH, Fannie MAH.** **SKIP** in-house structuring for now; refer to specialist lenders and syndicators and verify terms later. P3.

### Gaps
- No verified 2026 term sheets for 223(a)(7), Fannie conventional tiers, Fannie MAH, Freddie TAH, bank, life company or CMBS multifamily. Program boxes for these must be filled from lender term sheets before going into the sizer.
- No verified correspondent split data or DRE disclosure rules for commercial loan brokerage compensation; these need legal review.
