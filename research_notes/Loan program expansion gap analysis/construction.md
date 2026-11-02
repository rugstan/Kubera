# Commercial and Multifamily Construction Lending as a Broker Business Line (Corin Commercial)

Research date: 2026-10-31. Method note: direct page fetches failed from this environment (rabbet.com and getbuilt.com would not resolve), so almost every vendor and market fact below comes from **web search result snippets** (search-engine summaries of the pages linked). Treat vendor numbers as vendor claims. Statute text was **not** pulled from leginfo.legislature.ca.gov; mirrors (Justia, public.law, FindLaw) were used and some are older versions. Items marked (older) predate 2025.

---

## 1. Construction loan product menu and typical sizing

### Takeaway
A California commercial broker can arrange six construction capital types, each sized differently. Bank construction loans run about 60–65% LTC (2026). HUD 221(d)(4) goes to 87% LTC market-rate and 90% affordable after the January 2025 change. Private/hard-money ground-up loans run 85–90% LTC, capped at 70–75% of ARV. SBA 504 is a 50/40/10 split with an interim construction lender. Agency forward commitments are unfunded take-outs that need a separate construction loan. C-PACE is a long-term, tax-assessment-repaid slice whose percentage cap for new construction is set by each program. One code-level finding: Corin's sizer still carries the pre-2025 HUD 221(d)(4) constants.

### Cited Findings

**Bank construction (senior, recourse)**
- Bank construction leverage is commonly 60–65% LTC. A Q1 2026 term-sheet review says banks price about 275–300 bps over SOFR at 60% LTC, and 325–350 bps at 65% LTC. — [COR Advisors, "Construction Loan Rates 2026" (search snippet)](https://www.coradvisors.net/2026/05/construction-loan-rates-2026.html)
- An April 2026 tracker puts the 2026 weighted-average construction loan rate at about 8.4%, with multifamily near 7.6%. Its illustrative bank deals sit at 60–62% LTC with a spread around 325 bps. Commitment fees are typically 0.5–1.5%. — [Terrapin CG, Commercial Construction Loan Rates 2026 (search snippet)](https://terrapincg.com/news/commercial-construction-loan-rates-2026)
- Debt funds quoted SOFR + 425–525 bps at 65–75% LTC (Q1 2026). — [COR Advisors (search snippet)](https://www.coradvisors.net/2026/05/construction-loan-rates-2026.html)
- Market tone (February 2026): "a year ago, finding a construction loan that ventured beyond 60 percent LTC was a tough search." This describes the first loosening of multifamily lending in years. — [GlobeSt, Feb 12 2026 (search snippet)](https://www.globest.com/amp/2026/02/12/multifamily-lending-sees-first-loosening-in-years-construction-demand-strengthens/)
- Take-out benchmark: CBRE Q2 2026 shows average permanent-loan DSCR of 1.43x, debt yield of 10.2% and commercial LTV of 59.6%. Construction lenders size against this exit. — [via Terrapin/COR search snippets; CBRE original not fetched](https://terrapincg.com/news/commercial-construction-loan-rates-2026)
- One snippet claimed the Fed raised rates on Sept 16, 2026. This is **unverified (single source)** and should not be relied on. — [search snippet, same result set](https://www.coradvisors.net/2026/05/construction-loan-rates-2026.html)

**HUD 221(d)(4) multifamily new construction / sub-rehab**
- Effective Jan 8, 2025, market-rate DSCR fell from 1.176x to 1.15x and LTC rose from 85% to 87%. Affordable DSCR fell from 1.15x to 1.11x and LTC rose from 87% to 90%. A middle-income tier (1.11x / 90%) requires 50% of units restricted at up to 120% AMI under a 10-year use restriction. — [Dwight Capital](https://dwightcapital.com/news/hud-announces-beneficial-changes-in-dscr-and-ltc-ltv-requirements-for-fha/); [NewPoint](https://newpoint.com/news/hud-announces-changes-dscr-and-ltcltv-requirements)
- Lenders market fully amortizing terms of 40+ years after construction (some say up to 43 years). These are lender marketing pages. — [multifamily.loans](https://www.multifamily.loans/hud-221d4-loans/); [hud.loans](https://www.hud.loans/fha-221d4/)
- Older term sheets (e.g., Greystone 2020) show different figures and are superseded. — [Greystone term sheet (older, 2020)](https://www.greystone.com/wp-content/uploads/2020/06/Greystone-FHA-HUD-Section-221d4-Loan-Term-Sheet.pdf)

**HUD 232 new construction (healthcare)**
- No 2026 primary source was retrieved in this pass. Corin's own assumptions file encodes 232 NC as 40-year term, 75% LTC (for-profit), 1.45x DSCR, MIP 0.77% annual / 1% upfront. **Unverified here.** — [Corin repo: lib/sizing/assumptions.ts lines 46–50](file:///home/user/Corin/lib/sizing/assumptions.ts)

**SBA 504 / 7(a) construction (owner-occupied)**
- 504 structure: typically 50% third-party (bank) loan, 40% 504/CDC debenture and 10% borrower equity. — [GPO 13 CFR 120 (older, 2014)](https://www.gpo.gov/fdsys/pkg/CFR-2014-title13-vol1/pdf/CFR-2014-title13-vol1-sec120-891.pdf); [SBA SOP 50 10 7 copy (2023)](https://colemanreport.com/wp-content/uploads/2023/05/SOP-50-10-7.pdf)
- Every 504 loan needs interim financing until the debenture funds. The interim lender funds construction draws and must sign SBA Form 2288 (Interim Lender Certification) no more than 60 days before debenture funding. — [SBA Form 2288](https://www.sba.gov/document/sba-form-2288-interim-lender-certification); [SBA Policy Notice on interim advances (2021)](https://www.sba.gov/sites/default/files/2021-09/Policy%20Notice%205000-814473_Interim%20Advance%20-508.pdf)
- SOP 50 10 8 was announced April 22, 2025 and took effect June 1, 2025. A search result references an SOP 50 10 8.1 effective 10/1/2026 (file name; date not independently confirmed). — [Coleman Report SOP 50 10 8](https://colemanreport.com/sba-sop-50-10-8-lender-and-development-company-loan-programs/); [SOP 50 10 8.1 docx link](https://colemanreport.com/wp-content/uploads/2026/08/SOP-50-10-8.1-effective-10.1.2026_0.docx)
- SBA construction draw administration topics in a Coleman training: aligning draw schedules, budgets and borrower equity injection; lien releases; performance bonds; certificate of occupancy; substantial completion; retention. — [Coleman Report training listing](https://colemanreport.com/construction-loan-closing-documentation-and-draw-administration-meeting-the-sop-requirements-with-perfection-12-11)
- Corin's sizer applies a 504 equity injection of 10% base, +5% for special-purpose property and +5% for start-up/new construction (code comment). — [Corin repo: lib/sizing/assumptions.ts line 74](file:///home/user/Corin/lib/sizing/assumptions.ts)

**Fannie Mae / Freddie Mac forward commitments**
- Fannie Mae's Unfunded Forward Commitment allows 30 months for construction plus lease-up combined, extendable under Part III Ch. 19. New construction and substantial rehab qualify. The guide is current as of August 2026. — [Fannie Mae MF Guide PDF](https://mfguide.fanniemae.com/fnmf-pdf/download/15546); [Fannie Mae UFC for 9% LIHTC](https://multifamily.fanniemae.com/financing-options/products/unfunded-forward-commitment-9-lihtc-properties)
- Freddie Mac's unfunded forward commitment does not advance construction funds. It locks the permanent rate/spread when the seller accepts the commitment. — [Freddie Mac MF Guide Ch. 17A](https://mf.freddiemac.com/docs/chapters/mf_guide_ch_17A.pdf)
- Freddie Mac launched a "Lease Up" program in early 2026. A $136M refi of construction debt allows extra proceeds once NOI rises in year two. **Single trade-press source.** — [pulse.bot summary](https://www.pulse.bot/real-estate/news/gowanus-refi-scores-a-first-with-freddie-macs-new-lease-up-program-147f51a6-08a7-4d61-aa55-fe45cdcee87b)
- FHFA raised each GSE's 2026 multifamily cap to $88B, from $73B. — [GlobeSt Jan 2 2026](https://www.globest.com/amp/2026/01/02/what-30b-more-in-gse-firepower-really-buys-multifamily/)

**Private / hard-money ground-up and heavy rehab**
- Leverage is up to 85–90% LTC, tiered by experience: one lender offers 90% for 4+ completed ground-up projects and 85% for 2–3. ARV is typically capped at 70–75%, and the loan is the lesser of the LTC and ARV results. — [New Silver CA](https://newsilver.com/ground-up/construction-loans-california/); [Builders Capital profile](https://privatelenderlink.com/profile/builders-capital/); [Park Place Finance](https://parkplacefinance.com/?p=6164); [Capital Funding](https://capitalfunding.com/?p=1767)
- Rates: New Silver CA from 9.75%; Park Place 9.99%+; general private range 8–14%. Points: 1–2% (New Silver), 2–4% (Park Place), some zero-point offers (ABL). Terms 12–24 months, interest-only. Minimum FICO 640–680. — [New Silver](https://newsilver.com/construction-loan/); [Park Place](https://parkplacefinance.com/?p=6164); [ABL](https://www.ablfunding.com/loan-programs/new-construction)
- Interest reserves are rolled into the loan when there is room under the LTC/LTARV caps. Project cost = land + budget + funded interest. — [PPF Term Sheet Builder](https://ppf-pricing.pages.dev/)
- All of these are lender marketing pages, not a market survey.

**C-PACE**
- California: legislation has "opened the door" for C-PACE on new construction, including hotels and multifamily. No percentage cap was found. — [Bisnow LA (search snippet, date unclear)](https://bisnow.com/los-angeles/news/sustainability/green-initiatives-are-more-affordable-than-developers-think-97440)
- Benchmarks from other states: term equals the weighted-average useful life of improvements, typically 15–30 years. Connecticut allows up to 35% of total eligible construction cost for top-performing buildings. Colorado (2018, older) allowed about 20% of eligible construction cost. — [Vermont legislature C-PACE 101 (Apr 2026)](https://legislature.vermont.gov/Documents/2026/Workgroups/House%20Energy%20and%20Digital/Bills/S.138/Witness%20Documents/S.138~Michael%20%20Yaki~C-PACE%20101%20-%20Orientation~4-1-2026.pdf); [CT Green Bank eligible costs](https://www.ctgreenbank.com/building-solutions/c-pace/new-construction-financing/eligible-costs/); [SRM Network (older, 2018)](https://www.srmnetwork.com/wp-content/uploads/2018/01/C-PACE_New_Construction_Scotsman_Feb18.pdf)

**Corin's sizer as of today (code inspection)**
- `HUD.multifamily.s221d4 = { maxLtc: 0.85, maxLtcAffordable: 0.87, minDscr: 1.176, minDscrAffordable: 1.15 }`. These are the **pre-Jan-2025** HUD numbers. Current figures are 87%/1.15x market-rate and 90%/1.11x affordable. `s223f` carries the same stale values. — [Corin repo: lib/sizing/assumptions.ts lines 58–61](file:///home/user/Corin/lib/sizing/assumptions.ts); compare [Dwight Capital](https://dwightcapital.com/news/hud-announces-beneficial-changes-in-dscr-and-ltc-ltv-requirements-for-fha/)
- White-label construction: `BRIDGE.construction = { maxLtc: 0.8, minDebtYieldOnCost: 0.065, termMonths: 30, spread: 4.5 }`. No interest reserve, contingency, retainage or ARV cap appears in the sizing constants. A grep for "interest reserve", "retainage" and "contingency" across lib/app/components returned nothing. — [Corin repo: lib/sizing/assumptions.ts line 116](file:///home/user/Corin/lib/sizing/assumptions.ts)

### Inferences
- Mezzanine and preferred equity are not sourced here (see Gaps). In practice they fill the gap between a 60–65% LTC bank senior and 85–90% total capitalization. That gap is where a broker earns the most for structuring.
- With bank senior at 60–65% LTC and private lenders at 85–90%, the sizer should offer a "stack" view (senior + mezz/pref + C-PACE + sponsor equity) rather than a single-loan result.
- The stale 221(d)(4) constants mean the sizer currently **understates** HUD proceeds by about 2–3 points of LTC and overstates the required DSCR. This is a quick fix.

### Gaps
- No 2026 sourced figures for mezzanine/pref equity pricing, attachment points or intercreditor norms; nothing found in this pass.
- No primary 2026 source for HUD 232 new-construction leverage/DSCR, or for 221(d)(4) MIP rates.
- No sourced typical interest-reserve sizing, hard-cost contingency percentage (commonly cited 5–10%, **unsourced**), or completion-guaranty and equity-first norms for bank deals.
- California C-PACE new-construction cap and term (set per program administrator) not found.
- SBA 7(a) construction specifics (e.g., the 7(a) rule for construction to occupy a percentage of the building) were not retrieved.

---

## 2. Underwriting package for a construction loan

### Takeaway
The package is fairly standard across lenders. The sources here document the HUD side best: a CPA cost certification, inspector reports on HUD forms, and, for the GC, prevailing-wage and identity-of-interest certifications. Most items in the package can be collected and checked by a broker before submission, so this is where Corin's document-vault and checklist agents add the most value.

### Cited Findings
- HUD requires a borrower cost certification by an independent CPA on completion. The GC must also cost-certify if the contract is cost-plus or there is an identity of interest. — [HUD MAP Guide 4430.G §3.2.5 / §13.4 via gocodebook (2020 rev. 2021)](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/3.2.5-cost-certification); [§13.4](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/13.4-entities-that-must-cost-certify)
- HUD's construction-period responsibilities and contract administration are set out in MAP Guide Ch. 12 (HUD inspector, contract administration, retainage). — [§4.4.3](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/4.4.3-construction-period-responsibilities); [§12.2.2](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/12.2.2-contract-administration)
- AIA G702/G703 is the industry-standard progress-billing format. The schedule of values (G703) supports the application/certificate (G702), including retainage and stored materials. — [Procore contract management](https://procore.com/project-financials/contract-management); [AIA Contracts: completing G702](https://learn.aiacontracts.com/how-to-complete-the-g702-payment-application/)
- Private lenders underwrite on LTC and ARV (as-complete value) together, with experience tiers on track record. Fees include underwriting, appraisal/valuation and legal. — [New Silver requirements](https://newsilver.com/construction-loan/construction-loan-requirements/); [Kiavi LTV vs LTC](https://www.kiavi.com/blog/ltv-vs.-ltc-what-to-know-for-your-investment-property)
- SBA 504 construction closings must document performance bonds, lien releases, certificate of occupancy and substantial completion. — [Coleman Report training](https://colemanreport.com/construction-loan-closing-documentation-and-draw-administration-meeting-the-sop-requirements-with-perfection-12-11)

### Inferences
- Standard package for broker intake (industry-standard; not individually sourced in this pass):
  - **Sponsor items:** sponsor PFS and REO schedule, entity docs.
  - **Cost and contract:** hard/soft cost budget with contingency, GMP or stipulated-sum GC contract, plans and specs, permits/entitlements, GC résumé/licensing/bonding/financials, construction schedule.
  - **Third-party reports:** appraisal (as-is land, as-complete, as-stabilized), market/feasibility study, plan-and-cost review by a third-party construction consultant, Phase I ESA (and geotech).
  - **Insurance and title:** builder's risk and GL insurance; title with mechanics'-lien coverage and date-down endorsements.
- Corin's planned "program checklists" and "AI document extraction + ratios" map directly onto this list. Budget parsing (hard/soft split, contingency percentage, interest reserve adequacy) is the highest-value extraction target.

### Gaps
- No retrieved source for the scope or price of third-party plan-and-cost review.
- No retrieved source for typical title endorsements (California CLTA/ALTA mechanics'-lien and date-down endorsement numbers) for construction loans.
- No retrieved source on builder's-risk requirements by lender type.

---

## 3. Loan administration after closing; broker vs lender ownership; where a broker adds value

### Takeaway
Draw administration belongs to the lender (or its servicer or fund-control agent). The sources here document HUD's process in detail: 10% retainage stepping down to 5% and then 2.5%, the HUD inspector, the HUD-92403 requisition, HUD-92448 trade-item changes, and cost certification before final advance. A broker's legitimate role is pre-closing and coordination. That means packaging draw requests, chasing lien waivers and pay apps, scheduling inspections, tracking budget/interest reserve, and steering conversion. In California, actually receiving and disbursing construction funds triggers the Escrow Law's "joint control agent" licensing regime.

### Cited Findings

**HUD 221(d)(4)/232 construction administration (MAP Guide 4430.G, rev. 2021)**
- Retainage is 10% of each advance until 50% complete. It may then step down to 5% until 75%, and to 2.5% until Final Endorsement, on the Regional Production Director's decision based on HUD CA/inspector recommendation. — [MAP Guide §12.15.5](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/12.15.5-amount-of-contractor-s-retainage-and-release)
- After 90% completion, an early partial release of GC retainage may be requested on HUD-92403, with surety consent where applicable. For non-identity-of-interest contractors, the remaining retainage may be released at the next-to-last advance after cost certification review and HUD-92451 adjustments. — [MAP Guide §e (early partial release)](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/e.-early-partial-release-of-retainage); [MAP lender duties for HUD-92403](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/appendix-2-quality-control-plans-and-identity-of-interest/a.12.1.6-map-lender-duties-for-processing-form-hud-92403)
- The HUD inspector is an independent third party contracted by HUD. It visits the site, attends progress meetings and writes reports. It can modify a requisition amount through trade-item modifications on HUD-92448, and the contractor supports claims with receipts, bills of lading and payroll evidence. — [MAP §12.1.3](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/12.1.3-hud-inspector); [App. 2 "the HUD inspector"](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/appendix-2-quality-control-plans-and-identity-of-interest/d.-the-hud-inspector)
- The final advance requires an approved mortgagor cost certification and maximum insurable mortgage (HUD-92580). It also requires a HUD-92448 with the Contractor's Prevailing Wage Certificate if holdback is still undisbursed. The final 100% inspection is reported on HUD-95379. — [MAP §12.7.7](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/12.7.7-final-advance); [§12.6.2](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/12.6.2-final-100-draw-completion-inspection)
- HUD also monitors interim draws. — [App. 2 §A.12.1.8](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/appendix-2-quality-control-plans-and-identity-of-interest/a.12.1.8-hud-monitoring-of-interim-draws)

**Draw inspections (market)**
- Trinity markets commercial and SFR draw inspections, including a free first inspection for qualified lenders. It publishes no lender price list. — [Trinity draw-inspection page](https://trinityonline.com/draw-inspection-ppc); [Trinity commercial service overview PDF](https://www.trinityonline.com/hubfs/Service%20Overviews/Commercial%20Draw%20Inspection%20Service%20Overview.pdf)
- NWCC (Northwest Construction Control) offers residential and commercial draw inspections with reports within 2 business days. No fee was published. — [PrivateLenderLink NWCC profile](https://privatelenderlink.com/profile/northwest-construction-control/)
- The only price signals are anecdotal and undated inspector-forum posts: $20–$50 per SFR draw inspection paid **to field inspectors** (not the lender price). — [NACHI forum](https://forum.nachi.org/t/draw-inspection-fee/128389)

**Private / SBA**
- SBA 504 interim lenders run construction draws, aligning them to budgets and equity injection, before Form 2288 and debenture take-out. — [SBA Form 2288](https://www.sba.gov/document/sba-form-2288-interim-lender-certification); [Coleman training](https://colemanreport.com/construction-loan-closing-documentation-and-draw-administration-meeting-the-sop-requirements-with-perfection-12-11)

### Inferences
- **Lender (or its servicer/fund-control agent) owns:**
  - draw approval and funding
  - inspection ordering and acceptance
  - percent-complete determination
  - retainage holdback and release
  - in-balance tests (the remaining undisbursed loan plus required equity must cover cost-to-complete)
  - change-order and reallocation approval
  - title date-downs before each advance
  - stop-notice handling
  - interest-reserve funding
  - conversion/payoff
- **Broker owns:** sizing; capital-stack design; lender selection; underwriting package; closing coordination; take-out arrangement (forward commitment or perm refi or HUD 223(f)); and **recapitalization** when a project goes out of balance (mezz/pref rescue, loan increase, extension).
- **Value-add "draw coordination as a service"** (borrower-side, not funds-handling): assemble the monthly draw package (G702/G703, invoices, conditional waivers from the GC and subs, stored-materials proof, change-order log); pre-check it against the lender's budget; schedule the inspector; track the interest reserve and contingency burn; and flag in-balance risk early. This feeds the refi/perm pipeline and creates a defensible relationship through to conversion.
- The broker should **never take custody of or disburse** construction funds unless licensed under the California Escrow Law or clearly exempt (see Section 5).

### Gaps
- Fannie/Freddie forward-commitment construction-period monitoring requirements were not retrieved.
- Typical bank draw cadence, inspection fees charged to the borrower, and title date-down costs were not found.
- No industry data on brokers charging for draw coordination (fee levels) was found.

---

## 4. Software for construction lending and draw management (features, integrations, prices)

### Takeaway
Lender-grade draw platforms rarely publish prices. Built and Land Gorilla are quote-only. Rabbet prices per draw: G2 shows a $139/month Standard tier, and one listing mentions a $15k minimum annual contract. Private-lender LOS/servicing suites bundle draw modules: Baseline from $995/month, plus Liquid Logics and LendingWise. AI is now standard positioning. Examples: Built's AI Draw Agent (read-only "audit mode" first), Land Gorilla's statutory lien-waiver auto-population and "AI-powered invoice & waiver tracking", and point solutions (MightyBot, V7, Build.inc). For a broker, the right move is to integrate with or hand off to these tools rather than rebuild a lender servicing system.

### Cited Findings

**Built Technologies (lender-side; banks/credit unions/private)**
- Modules: loan management, draw request management, budget management, document management, workflow automation, draw inspections. — [Built features (search snippet)](https://getbuilt.com/features)
- **AI Draw Agent:** the first stage is an "audit mode" doing read-only analysis of the draw package. It builds structured budgets and splits draw packages automatically. Vendor claims: 2–5x capacity, 100% policy adherence, 2x more risks flagged, up to 95% faster draw processing. — [getbuilt.com/ai (search snippet)](https://getbuilt.com/ai)
- CB Insights says the Draw Agent cut residential draw timelines from about 7 to about 3 business days on average (vendor-sourced). — [CB Insights](https://www.cbinsights.com/investor/built); [HousingWire on AI in draws](https://www.housingwire.com/articles/ai-transforming-construction-draws/)
- Pricing: on request only; no public tiers. — [G2 Built pricing](https://www.g2.com/products/built/pricing); [Techjockey](https://www.techjockey.com/ae/detail/built)
- Built publishes lien-waiver automation content. — [Built blog: lien waiver automation](https://getbuilt.com/blog/lien-waiver-automation/)

**Land Gorilla (lender-side)**
- Statutory Lien Waivers tool: integrates state-specific statutory waivers into the draw process and auto-populates them. It supports e-signature requests and side-by-side comparison against waivers submitted by contractors. Separate lien-monitoring product sends same-day lien alerts. The homepage advertises "AI-Powered Invoice & Waiver Tracking". — [Land Gorilla press release (undated in snippet)](https://landgorilla.com/news-and-events/press/land-gorilla-automates-statutory-lien-waiver-process-helping-construction-lenders-reduce-costs-and-risk/); [Lien monitoring](https://landgorilla.com/lien-monitoring-for-construction-loans/); [Homepage](https://landgorilla.com/)
- Pricing: G2 shows "custom". Software Advice/GetApp show "$25 one-time, per-loan pricing option" (unverified with vendor). — [G2](https://www.g2.com/products/land-gorilla/pricing); [Software Advice](https://www.softwareadvice.com/loan-origination/construction-loan-manager-profile); [Capterra](https://www.capterra.com/p/147212/Construction-Loan-Manager/)
- No dedicated AI draw-review engine was documented in the retrieved materials.

**Rabbet (lender and developer products)**
- The lender product ("Rabbet for Construction Loan Administration") serves lenders, servicers and lender service providers doing draw review, hard-cost monitoring and funds control. Pricing is per draw, based on project volume/length/size, with custom quotes and "3 pricing options". — [Rabbet lenders pricing (search snippet)](https://rabbet.com/lenders-pricing)
- G2 lists a Standard Edition at $139/month based on draws processed, plus "Lender Premium" at contact-us (G2 updated Feb 2025). FitGap mentions a "$15,000 minimum annual contract" not tied clearly to a product. — [G2 Rabbet pricing](https://www.g2.com/products/rabbet/pricing); [FitGap](https://us.fitgap.com/products/051237/rabbet)
- Features: draw packaging; budget management; centralized document intake; portfolio reporting; automated covenant checks; SOC 2. Premium tier adds cash-flow projections, **HUD forms**, borrower portal and third-party invites. Integrations: core banking, servicing, document repositories; SSO. — [Rabbet loan admin page](https://rabbet.com/construction-loan-management-software); [FitGap](https://us.fitgap.com/products/051237/rabbet); [Capterra](https://www.capterra.co.za/software/1241374/Rabbet-Construction-Lending)

**Northspyre (developer side)**
- Developer project and budget management. "Complex Capital Management" maps budget lines so invoices draw automatically against defined sources (lender/equity). Tailored draw templates meet each lender's requirements. Nov 2025 release added advanced analytics and lender/investor reporting. — [Northspyre training](https://www.northspyre.com/training-webinars/complex-source-tracking-automation); [BusinessWire Nov 4 2025](https://www.businesswire.com/news/home/20251104458535/en/Northspyre-Unveils-Advanced-Analytics-and-Capital-Management-Features-to-Help-Developers-Drive-Higher-Returns-with-Less-Risk)
- Pricing: not published (GetApp "no pricing info"). — [GetApp](https://www.getapp.com/all-software/a/northspyre/)

**Procore (GC side)**
- Payment applications follow the G702/G703 format with retainage and stored materials. Procore can generate a customizable G702/G703. Procore Pay covers invoice management, lien waivers, disbursements and compliance. Pricing is ACV-based custom quote. — [Procore contract management](https://procore.com/project-financials/contract-management); [Constructionplacements (June 2026)](https://www.constructionplacements.com/best-construction-payment-software/); [Toolradar](https://toolradar.com/compare/payapppro-vs-procore)

**Private-lender LOS/servicing with draw modules**
- **Baseline:** draw management is in the core product, and borrowers submit draws in the borrower portal. Pricing: Essential $995/mo and Growth $1,995/mo, month-to-month. Capterra US shows "$75,000/user/month", likely a data error. — [Software Advice](https://www.softwareadvice.com/loan-servicing/baseline-profile); [GetApp](https://www.getapp.com/loan-servicing-software/a/baseline); [G2](https://www.g2.com/products/baseline-financial-technologies-baseline); [PrivateLenderLink (Feb 2024, older)](https://privatelenderlink.com/2024/02/baseline-software-features-and-experience-for-private-lenders/)
- **Liquid Logics (NOVA):** handles draw requests, inspection scheduling, approval workflow, disbursement and draw history. Integrations announced with Sekady, Trinity (Aug 2025) and NWCC. A ground-up lender case study claims growth from $85M to $165M in 12 months. — [Trinity–Liquid Logics (Aug 26 2025)](https://www.trinityonline.com/blog/trinity-liquid-logics); [PRNewswire Sekady partnership](https://prnewswire.com/news-releases/sekady-and-liquid-logics-forge-partnership-to-enhance-workflow-automation-and-security-for-private-lenders-302299160.html); [Liquid Logics case study](https://www.liquidlogics.com/?p=2369); [NWCC integration](https://journalofcyberpolicy.com/?p=346739)
- **LendingWise:** has a draw management roadmap "from passive tracking to active management of budgets and draws". Inspection integrations (Built, Sekady, Trustpoint.ai, CFSI) appear on its feedback board as **requests, not confirmed launches**. — [LendingWise draw roadmap](https://help.lendingwise.com/knowledge/draw); [Upvoty: Built](https://lendingwise.upvoty.com/b/integrations/built-draws-inspections/); [Upvoty: Trustpoint.ai](https://lendingwise.upvoty.com/b/integrations/trustpointai-draw-inspections/)
- **Others with draw modules:** The Mortgage Office; Mortgage Automator. — [TMO](https://www.themortgageoffice.com/simplifying-construction-loan-draw-requests/); [Mortgage Automator glossary](https://www.mortgageautomator.com/glossary/los-with-construction-draw-management)

**Inspection / fund-control networks**
- Trinity, NWCC, Sekady, Trustpoint.ai and CFSI appear as inspection/fund-control integrations in LOS ecosystems. Prices were not published for any of them. — [Trinity](https://www.trinityonline.com/blog/draw-inspections); [NWCC](https://privatelenderlink.com/profile/northwest-construction-control/); [Sekady blog](https://www.sekady.com/sekady-blog/how-does-construction-draw-software-help-lenders); [Liquid Logics–Trustpoint](https://www.liquidlogics.com/?p=1736)

**AI point solutions (draw review)**
- MightyBot markets AI draw review that validates lien waivers, checks inspection evidence and enforces lender policy. Self-reported claims: 70%+ faster processing, 95% extraction accuracy. — [MightyBot use case](https://mightybot-ai.pages.dev/use-cases/construction-draw-reviews/)
- V7 markets an AI agent for construction loan administrators with "90% faster draw processing" (vendor claim). Build.inc publishes on AI pay-app/draw review. A "draw package review" skill exists in the A.CRE intelligence library. — [V7](https://www.v7labs.com/agents/ai-agent-for-construction-loan-administrators); [Build.inc](https://build.inc/insights/ai-construction-draw-review-payment-applications); [A.CRE](https://intelligence.adventuresincre.com/skills/draw-package-review)

### Inferences
- Off-the-shelf lender platforms (Built, Land Gorilla, Rabbet Lender) assume the user holds the loan and funds draws. Corin as a pure broker is not their buyer. If Corin's white-label table-funding partner or its own future hard-money book funds draws, Baseline ($995–$1,995/mo) or Liquid Logics is the realistic lender-of-record stack, with Trinity/NWCC inspections plugged in.
- Corin's AI stack (Claude extraction plus Inngest workflows) can replicate the **"audit mode" read-only draw-package review** that Built positions as step one. Examples: G702/G703 math checks, waiver-to-payee matching, budget-line overdraw and in-balance checks. Corin would offer this as a borrower-side pre-check before the package goes to the lender.
- Developer-side tools (Northspyre) and GC-side tools (Procore) are the data sources borrowers already use. Import/parse of their exported pay apps is more valuable than a native integration.

### Gaps
- No public 2026 price for Built, Land Gorilla, Northspyre, Procore Pay, Liquid Logics, LendingWise draw module, Trinity, NWCC or Sekady.
- **IVI, Inspectify and "Constructive Capital"** produced no relevant draw-inspection results in this pass. Their existence and offerings for commercial construction draws are unconfirmed.
- No independent (non-vendor) validation of any AI draw-review accuracy or speed claims.
- No API documentation was retrieved for any vendor.

---

## 5. California specifics: mechanics' liens, waivers, stop payment notices, prevailing wage, licensing

### Takeaway
California mandates four statutory lien waiver forms (Civ. Code §§8132–8138), which must "substantially" follow the statute. Bonded stop payment notices (Civ. Code §8530 et seq.) bind construction lenders and take priority. Prevailing wage can attach to private projects with public subsidy (Lab. Code §1720), including forgiven or contingently repaid public loans. Receiving and disbursing construction funds for others is regulated "joint control agent" activity under the Escrow Law (Fin. Code §17005.1). The real estate broker exemption (§17006(a)(4)) covers only escrows incidental to transactions where the broker is agent or party. A broker-run draw-disbursement service is therefore high-risk without a DFPI escrow license or a licensed partner.

### Cited Findings

**Lien waivers**
- The four statutory forms are: §8132 conditional progress, §8134 unconditional progress, §8136 conditional final, §8138 unconditional final. CSLB says waivers must "follow, substantially," these forms. Some vendor pages claim verbatim wording is required; that is stricter than CSLB's statement. — [CSLB waiver forms page](https://cslb.ca.gov/consumers/legal_issues_for_consumers/Mechanics_Lien/Conditional_And_Unconditional_Waiver_Release_Form.aspx); [Civ. Code §8132 (public.law)](https://california.public.law/codes/civil_code_section_8132); [§8138](https://california.public.law/codes/civil_code_section_8138)
- A conditional waiver becomes effective as an unconditional waiver once the claimant receives payment, per a law-firm summary (secondary source). — [LCW Legal](https://lcwlegal.com/news/california-construction-payments-the-what-and-why-of-conditional-waivers-releases)
- Notarization is not required for §§8132–8138 waivers (secondary guide; not confirmed against statute). — [paidwrite guide](https://paidwrite-site.pages.dev/guides/california-lien-waiver/)

**Stop payment notices (private works)**
- A construction lender receiving a stop payment notice must withhold funds sufficient to cover the claim (§8536(a)). The lender may elect not to withhold if the notice is unbonded, or if it is from a non-direct-contractor after a payment bond was recorded (§8536(b)). — [Civ. Code §8536 (public.law)](https://california.public.law/codes/civil_code_section_8536); [Justia 2011](https://law.justia.com/codes/california/2011/civ/division-4/8530-8538/8536/)
- Bonded notices (bond at 125% of the claim per secondary sources) are paid first in priority (§8540). An owner/contractor assignment of loan funds does not defeat the claimant. Practice notes say bonded notices can reach amounts already paid to the lender from the loan fund (Familian, 1989). The lender has 20 days to object to sureties (§8534). — [Lorman](https://www.lorman.com/resources/effect-of-serving-a-stop-payment-notice-private-works-16962); [Justia §8534](https://law.justia.com/codes/california/2011/civ/division-4/8530-8538/8534/); [Levelset Q&A](https://www.levelset.com/payment-help/question/does-a-construction-lender-have-to-withhold-funds-on-an-bonded-stop-notice-that-is-not-bonded)

**Prevailing wage on privately developed, publicly assisted projects**
- Lab. Code §1720 covers work "paid for in whole or in part out of public funds." This includes money **forgiven** by a public entity and money **loaned** that is repaid on a contingent basis. §1720(c)(3) exempts de minimis subsidies (no statutory dollar threshold; a $75k bill was vetoed). §1720(c)(4) addresses affordable-housing set-aside funds. — [Leg. analysis AB 2272 (2014)](https://www.leginfo.ca.gov/pub/13-14/bill/asm/ab_2251-2300/ab_2272_bill_20140903_enrolled.htm); [Allen Matkins: public subsidies](https://allenmatkins.com/real-ideas/public-subsidies-not-allowing-the-tail-to-wag-the-dog.html); [DIR coverage determination example](https://dir.ca.gov/OPRL/coverage/year2009/2009-045.pdf)
- HUD's final advance requires a Contractor's Prevailing Wage Certificate (federal Davis-Bacon context for 221(d)(4)). — [MAP §12.7.7](https://gocodebook.com/library/us/federal/us-hud-map-guide-4430-g-2020-rev2021-03-19/12.7.7-final-advance)

**Licensing for a broker coordinating or disbursing draws**
- Fin. Code §17005.1: a "joint control agent" is a person engaged in the business of receiving money or property for disbursal in payment of construction labor, materials, services, permits and fees. This applies whether or not compensation is paid. Real estate lending and acting as a lender's authorized representative/loan correspondent are excluded. Escrow agents include joint control agents (except as §17004 provides). — [Fin. Code §17005.1 (public.law)](https://california.public.law/codes/financial_code_section_17005.1); [DFPI Escrow Law definitions](https://dfpi.ca.gov/escrow-law/general-definitions)
- Fin. Code §17422: a joint control agent may not pay construction costs until it determines substantial compliance with the control agreement, unless it acts on the principals' written instructions. Joint control agents are regulated under 10 CCR §1710. — [Justia §17422 (2016)](https://law.justia.com/codes/california/2016/code-fin/division-6/chapter-3/section-17422/); [10 CCR §1710](https://law.cornell.edu/regulations/california/10-CCR-1710)
- Fin. Code §17006(a)(4) exempts licensed real estate brokers only for escrows **incidental to a transaction in which the broker is an agent or party** and performing licensed acts. DRE has disciplined brokers whose escrows fell outside this. The burden of proving the exemption is on the claimant. — [Fin. Code §17006 (Justia 2020)](https://law.justia.com/codes/california/2020/code-fin/division-6/chapter-1/section-17006/); [DRE Real Estate Bulletin Spring 2010 (older)](https://WWW.DRE.CA.Gov/files/pdf/reb/rebspring_10.pdf); [DRE hearing decision example](https://www2.dre.ca.gov/hearingfiles/H41802LA_201016_P.pdf)
- Civ. Code §8726 (construction security escrow accounts) requires holding by an Escrow Law licensee or specified exempt persons. — [Civ. Code §8726 (public.law)](https://california.public.law/codes/civil_code_section_8726)

### Inferences
- A broker that **only coordinates** (collects documents, pre-reviews and forwards to the lender, with the lender or a licensed fund-control company disbursing) does not appear to "receive money for disbursal." It is therefore likely outside §17005.1. **This needs counsel confirmation.**
- If Corin itself becomes a lender (hard-money/table-funded), the §17005.1 lending exclusion may cover disbursing its own loan proceeds. Holding borrower equity or third-party funds, however, would not be covered.
- If Corin arranges loans funded by private investors under DRE (B&P Code §10237 / multi-lender rules), the trust-fund rules on construction holdbacks are a separate DRE compliance issue (not researched here).
- The waiver module must generate and verify all four statutory forms, and enforce the "conditional before payment, unconditional after funds clear" sequence, per payee per draw.

### Gaps
- Exact current §17006 text and DFPI guidance on whether a DRE broker can act as a joint control agent for loans it arranged: not retrieved. **Needs counsel.**
- No retrieved source on whether California tax credits, C-PACE or local fee deferrals count as "public funds" under §1720.
- Mechanics' lien recording deadlines (§§8412–8414) and preliminary notice (§8200) were not researched in this pass.
- DRE trust-fund handling for multi-lender construction holdbacks was not researched.

---

## 6. Capabilities Corin Commercial is missing (build / integrate / skip)

### Takeaway
Corin already sizes construction (221(d)(4), white-label LTC/debt-yield-on-cost) and has the AI/workflow plumbing. The gaps fall into three groups. First, construction-specific **sizing** (interest reserve, contingency, ARV cap, stacks, current HUD constants). Second, a **construction underwriting checklist/extraction** layer (budget, GMP, schedule, third-party reports). Third, a borrower-side **draw coordination** layer (G702/G703 parsing, California statutory waivers, in-balance tracking). Funds custody and lender-grade servicing should stay with partners.

### Cited Findings
- Stale HUD constants and no reserve/contingency/retainage logic were found in Corin's sizer. — [Corin repo: lib/sizing/assumptions.ts](file:///home/user/Corin/lib/sizing/assumptions.ts); [Dwight Capital 2025 HUD changes](https://dwightcapital.com/news/hud-announces-beneficial-changes-in-dscr-and-ltc-ltv-requirements-for-fha/)
- Private lenders fund interest reserves inside LTC/ARV caps and size on the lesser of LTC and ARV. — [PPF Term Sheet Builder](https://ppf-pricing.pages.dev/); [Park Place](https://parkplacefinance.com/?p=6164)
- Lender draw platforms are quote-only. Private-lender LOS with draw modules starts at $995/mo (Baseline). — [Software Advice Baseline](https://www.softwareadvice.com/loan-servicing/baseline-profile); [G2 Built](https://www.g2.com/products/built/pricing)
- Joint control agent licensing applies to anyone in the business of receiving construction funds for disbursal. — [Fin. Code §17005.1](https://california.public.law/codes/financial_code_section_17005.1)

### Inferences — capability list (tag: build / integrate / skip)

**Sizing and structuring**
1. **Update HUD 221(d)(4)/223(f) constants** to 87%/1.15x market-rate and 90%/1.11x affordable; add the middle-income tier. — **build** (config change; add a test)
2. **Interest reserve calculator** (draw curve or S-curve × rate × months to stabilization), funded inside LTC. — **build**
3. **Hard/soft cost contingency and developer fee inputs**, with lender-specific caps. — **build**
4. **Lesser-of LTC / LTV-as-complete (ARV) / debt-yield-on-cost / DSCR-at-stabilization sizing** for private ground-up and heavy rehab, with experience tiers (e.g., 85% vs 90% LTC by completed projects). — **build**
5. **Capital-stack view** (senior + mezz/pref + C-PACE + sponsor equity, equity-first check) with blended cost. — **build**
6. **Construction-to-perm / take-out test**: size the exit loan (agency forward commitment, HUD 223(f), CMBS/bank perm) at stabilization and flag refi risk. — **build**
7. **C-PACE eligibility screen** (California program-specific). — **integrate** (partner with C-PACE capital providers/administrators; the cap is program-set)

**Underwriting package**
8. **Construction program checklists**: budget, GMP contract, plans/specs, permits, GC qualifications/licence (CSLB lookup)/bonding, schedule, appraisal (as-is/as-complete/as-stabilized), feasibility, plan-and-cost review, Phase I/geotech, builder's risk, title with mechanics'-lien and date-down endorsements. — **build** (on the planned checklist module)
9. **AI budget extraction**: parse a budget into hard/soft/contingency lines, check against the GMP schedule of values, compute LTC and contingency percentage. — **build** (Claude extraction agent)
10. **GC/sponsor track-record module**: completed projects count drives the leverage tier. — **build** (extend the sponsor/guarantor module)
11. **Third-party report ordering** (appraisal, plan-and-cost review, Phase I). — **integrate** (planned vendor-order tracking; partner AMCs/consultants)
12. **CSLB contractor licence verification**. — **integrate** (public CSLB lookup)

**Post-closing draw coordination (borrower-side service; no funds custody)**
13. **Draw package builder**: G702/G703 upload, math/retainage/stored-materials checks, budget-line overdraw and in-balance test, change-order log. — **build** (Claude extraction plus rules; mirrors Built's read-only "audit mode")
14. **California statutory lien waiver generation and tracking** (§§8132/8134/8136/8138) per payee per draw; conditional-to-unconditional sequencing; e-sign. — **build** (templates plus e-sign already planned). Optionally **integrate** Land Gorilla/Built if the funding lender uses them.
15. **Interest reserve and contingency burn dashboard** with early-warning alerts for an out-of-balance condition (a trigger for rescue mezz/loan-increase brokerage). — **build**
16. **Inspection scheduling** (Trinity, NWCC). — **integrate** (order through partners; do not build an inspection network)
17. **Stop payment notice / lien alert intake**. — **integrate** (title company or lien-monitoring service such as Land Gorilla lien monitoring)
18. **Photo-based progress tracking (AI)**. — **skip** for now (lender/inspector territory; no sourced vendor data; low broker ROI)
19. **Developer-side and GC-side data import** (Northspyre and Procore exports). — **integrate** via file import/parsing; skip native API until volume justifies it
20. **Prevailing wage flag**: screen for public subsidy (forgiven/contingent public loans, HUD Davis-Bacon) and warn in the term sheet. — **build** (Jev rule)

**Funding, servicing and compliance (if Corin funds hard-money or table-funded loans)**
21. **Lender-of-record draw servicing and disbursement** (funds control, wire release, title date-down ordering). — **integrate** (Baseline $995–1,995/mo or Liquid Logics; or the white-label funding partner's servicer). Do not build.
22. **Holding or disbursing construction funds as joint control agent**. — **skip** unless DFPI-licensed. Get a counsel opinion on §17005.1/§17006(a)(4) and DRE trust-fund rules first. Partner with a licensed fund-control company.
23. **Lender-grade construction loan administration platform** (Built, Land Gorilla, Rabbet Lender). — **skip** while a pure broker. Reconsider only if the table-funding book exceeds the point where per-draw pricing beats manual work.
24. **Conversion/payoff tracker**: monitors completion (CO, cost certification for HUD, lease-up metrics) and triggers the perm/223(f)/agency refi outreach. — **build** (deal-desk stage templates plus Inngest)
25. **Mezz/pref equity lender database** in Jev routing. — **build** (data entry plus rules; providers not yet sourced)

### Gaps
- Pricing for any integration partner except Baseline is unknown, so build-vs-integrate cost comparisons are qualitative.
- No legal confirmation that borrower-side draw coordination (without funds custody) is outside the Escrow Law. This is the key compliance dependency for item 13–15 as a paid service.
