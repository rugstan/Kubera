# Arive (arive.com): 2026 feature inventory and relevance to Kubera Commercial

How these notes were sourced: direct page fetches of arive.com and yespress.io failed from this environment (DNS blocked, `ENOTFOUND`). I did not open any Arive page directly, so **every finding below comes from a web-search result summary or snippet** of the cited URL. Treat exact prices, version numbers and dates as "per search snippet". Facts dated before 2026 are marked [pre-2026].

---

## 1. What modules and features does Arive offer (by module)?

### Takeaway
Arive is an all-in-one cloud platform for independent residential mortgage brokers. It combines an LOS, a borrower POS, a CRM, a products and pricing engine (PPE) tied to an integrated wholesale-lender marketplace, a realtor portal, built-in e-sign, and lender-specific submission and conditions integrations. It has no open API (Zapier only), and I found no native AI feature confirmed for 2026.

### Cited Findings

**Company and positioning**
- Arive is based in San Ramon, CA. Its cloud platform combines a loan origination system, a borrower point of sale, a product and pricing engine, and an integrated wholesale-lender marketplace (search summary of Arive press pages) — [Arive press, GMFS, Jun 1 2026](https://www.arive.com/press/gmfs-joins-the-arive-platform-to-deliver-faster-pricing-streamlined-workflows-and-high-touch-partner-support); [What is Arive (support)](https://support.arive.com/support/solutions/articles/61000271217-what-is-arive-)
- It was launched in association with AIME (the broker trade association) [pre-2026] — [MPA: AIME upends broker market with launch of Arive](https://www.mpamag.com/poweroriginator/marketing-technology/aime-upends-broker-market-with-launch-of-arive-114384.aspx); [HousingWire: AIME chairman Anthony Casa announcing Arive](https://www.housingwire.com/articles/47988-watch-aime-chairman-anthony-casa-announcing-arive-to-support-32-export)
- Its pitch is consolidation: brokers had historically used separate POS, CRM, agent portal, LOS and lender portals. Arive bundles "a modern mobile-friendly LOS, a rich configurable consumer POS, a co-branded Real Estate Agent portal and a products and pricing engine" (search snippet) — [MPA: ARIVE highlights all-in-one platform](https://mpamag.com/us/specialty/technology/arive-highlights-all-in-one-platform-to-take-brokers-to-the-next-level/511539); [MPA: The Arive experience is here](https://m.mpamag.com/us/mortgage-industry/industry-trends/the-arive-experience-is-here/124006)

**LOS (loan origination)**
- The LOS covers every phase of the loan process. A third-party directory lists automated workflow and task management and integrated CRM functionality (search snippet) — [What is Arive (support)](https://support.arive.com/support/solutions/articles/61000271217-what-is-arive-); [NAMB Technology Partner Directory (PDF)](https://irp.cdn-website.com/f3cf809c/files/uploaded/NAMB+Technology+Partner+Directory+8.5+x+11.pdf)
- v2026.1.0.0 added task assignment to specific users and category and pinned-note filters for Global Notes. It also implemented the South Carolina State Report — [Release Notes v2026.1.0.0](https://support.arive.com/support/solutions/articles/61000317533-arive-release-notes-v2026-1-0-0)
- v2025.7.0.0 added task management with auto-completion (HOT-25570) [pre-2026] — [Release Notes v2025.7.0.0](https://support.arive.com/support/solutions/articles/61000316064-arive-release-notes-v2025-7-0-0)
- v2026.2.0.0 added an automatic DSCR calculation from property income and debt service. It also added a "Multi-Family (5–10 Units)" Property Type option for Non-QM mortgages — [Release Notes v2026.2.0.0](https://support.arive.com/support/solutions/articles/61000317947-arive-release-notes-v2026-2-0-0); [Release Notes v2026.2.0.0 (alt URL)](https://support.arive.com/support/solutions/articles/61000317997-arive-release-notes-v2026-2-0-0)
- v2026.3.0.0 lets admins manage document folders and classifications from Company Settings ("Document Folders"). It also implemented MCR v7 updates for Q1 2026 onward — [Release Notes v2026.3.0.0](https://support.arive.com/support/solutions/articles/61000318020-arive-release-notes-v2026-3-0-0)
- I found no release notes after v2026.3 (April 2026) in search results.

**POS / borrower portal**
- "Borrower Point of Sale (POS) for consumer loan applications and engagement", described as a "rich configurable consumer POS" (search snippet) — [What is Arive (support)](https://support.arive.com/support/solutions/articles/61000271217-what-is-arive-); [MPA all-in-one](https://mpamag.com/us/specialty/technology/arive-highlights-all-in-one-platform-to-take-brokers-to-the-next-level/511539)
- POS themes and LOS white-labeling are plan features (see pricing). Admins can customize the LOS, POS and Realtor Portal login URLs (support index title only) — [Arive Pricing](https://arive.com/pricing); [Arive support index](https://support.arive.com/support/solutions/61000132646)

**CRM and marketing automation**
- CRM is built in. A directory description mentions mortgage CRM automation, processing worksheets and loan-amount history tracking (search summary; low detail) — [HousingWire company profile](https://www.housingwire.com/company-profile/arive-2/); [SourceForge ARIVE](https://sourceforge.net/software/product/ARIVE/)
- I found no Arive-native documentation of email or SMS drip campaigns. Third parties sell HubSpot-via-Zapier setups that trigger email and SMS campaigns from Arive loan milestones and send status updates to referring agents. These are vendor marketing claims — [Proven ROI: Arive and HubSpot](https://www.provenroi.com/services/arive-and-hubspot); [Proven ROI: Zapier vs RESTful API](https://www.provenroi.com/arive-api-integration-zapier-or-restful-api-which-is-better-for-hubspot)
- Konnectd sells a bundled Arive-integrated marketing CRM: a $199 setup fee plus a $2,970/yr "unlimited" tier (search snippet) — [Konnectd signup](https://signup.konnectd.io/)
- Experience.com lists an Arive integration (reviews/reputation; listing only) — [Experience.com integrations: Arive](https://www.experience.com/integrations/arive)

**Pricing engine (PPE) and wholesale lender marketplace**
- The PPE consolidates rate sheets across wholesale lenders. Brokers can compare rates, create quotes and register loans electronically with lenders. A directory lists real-time lender products and rates, product comparison, pricing quotes, fee worksheets and product qualification (search summary) — [What is Arive (support)](https://support.arive.com/support/solutions/articles/61000271217-what-is-arive-); [NAMB directory](https://irp.cdn-website.com/f3cf809c/files/uploaded/NAMB+Technology+Partner+Directory+8.5+x+11.pdf)
- 2026 lender additions on Arive press pages:
  - HomeXpress (Non-QM / investor), Feb 26: [press](https://www.arive.com/press/homexpress-mortgage-corp-launches-on-the-arive-platform-expanding-broker-access-to-non-qm-and-investor-lending); [HomeXpress PR PDF](https://homexmortgage.com/wp-content/uploads/2026/02/HomeXpress-_-ARIVE-PR-02.26.26.pdf)
  - Loanstream, Mar 10: [press](https://www.arive.com/press/loanstream-now-integrated-into-arives-expanding-wholesale-lender-marketplace)
  - LendingPros, Mar 11: [press](https://www.arive.com/press/lendingpros-joins-arives-integrated-lender-marketplace)
  - RISE TPO, Mar 11: [press](https://www.arive.com/press/arive-welcomes-rise-tpo-to-its-integrated-lender-marketplace)
  - GIANT Lending, Mar 12: [press](https://www.arive.com/press/giant-lending-launches-on-arive-expanding-broker-access-to-performance-driven-lending-solutions)
  - Keystone Funding, Apr 1: [press](https://arive.com/press/keystone-funding-inc-joins-the-arive-platform)
  - GMFS, Jun 1: [press](https://www.arive.com/press/gmfs-joins-the-arive-platform-to-deliver-faster-pricing-streamlined-workflows-and-high-touch-partner-support)
  - TPO Go, Jun 8: [press](https://arive.com/press/tpo-go-integrates-with-arive-bringing-its-full-suite-of-broker-focused-products-and-pricing)
  - A Mortgage Boutique, Jul 21: [press](https://www.arive.com/press/arive-expands-lender-marketplace-with-the-addition-of-a-mortgage-boutique)
  - Oaktree Funding (Non-QM: bank statement, DSCR, asset utilization), Jan 5: [press](https://www.arive.com/press/oaktree-funding-corp-joins-the-arive-platform-expanding-broker-access-to-flexible-non-qm-lending-solutions)
- Rocket Pro TPO joined, bringing pricing and submission into Arive. Rocket noted that fewer than 10% of its broker partners were using Arive for LOS at that time [date of quote unclear; likely pre-2026] — [HousingWire: Rocket Pro TPO joins Arive](https://www.housingwire.com/articles/rocket-pro-tpo-joins-arive-platform/); [NMN: Rocket Pro to join Arive](https://www.nationalmortgagenews.com/news/rocket-pro-to-join-arive-loan-origination-platform); [NMP: Rocket Pro has ARIVE'd](https://nationalmortgageprofessional.com/news/rocket-pro-has-arived)
- HomeXpress said about 33% of its active broker partners already operate on Arive — [HomeXpress PR PDF](https://homexmortgage.com/wp-content/uploads/2026/02/HomeXpress-_-ARIVE-PR-02.26.26.pdf)
- One search summary said a Rocket Pro "Phase 2" (loan file submission and status updates inside Arive) was announced June 23, 2026. I could not tie this to a specific URL in the results, so it is unverified.

**Lender connectivity, loan submission and conditions**
- Loans are registered and submitted electronically to integrated lenders from the PPE — [What is Arive (support)](https://support.arive.com/support/solutions/articles/61000271217-what-is-arive-)
- Conditions management is lender-specific. JMAC's integration lets brokers view conditions, upload documents and submit conditions to JMAC for review from Arive. It can be toggled in Lender Integration settings — [JMAC Help: Managing Conditions in ARIVE](https://help.jmaclending.com/hc/en-us/articles/50989320206099-Managing-Conditions-in-ARIVE)
- I found no documentation of a generic, lender-agnostic conditions tracker.

**Disclosures and compliance**
- LEs, initial disclosures, change-of-circumstance forms, CDs and closing packages are generated through DocMagic. Document sets are managed on DocMagic's site and pulled into Arive automatically, and eSign status can be tracked and links resent (search summary) — [Arive support: DocMagic](https://support.arive.com/en/support/solutions/articles/61000308107)
- NMLS Mortgage Call Report: from Reports > Call Reports, pick states, year and quarter, then export XML or XLSX (the XLSX includes a loan-list tab). Users can correct numbers manually before uploading. Investment-property (business-purpose) loans have been excluded from the MCR since Q1 2024. The Annual MCR (financial condition) is not supported. Compensation date, amount and payer fields feed the MCR — [Generate Call Reports (MCR)](https://support.arive.com/support/solutions/articles/61000281236-generate-call-reports-mcr-)
- State reports: South Carolina State Report added in v2026.1 — [v2026.1.0.0](https://support.arive.com/support/solutions/articles/61000317533-arive-release-notes-v2026-1-0-0)
- HMDA LAR: I found no Arive-specific documentation in search results (see Gaps).
- Audit trail: Finalized documents are locked (no reclassify, rename, edit or delete) and a Finalized Docs folder exists (v2024.5) [pre-2026] — [v2024.5.0.0](https://support.arive.com/support/solutions/articles/61000312763-arive-release-notes-v2024-5-0-0)

**Document management**
- Document folders and classifications are admin-configurable (v2026.3) — [v2026.3.0.0](https://support.arive.com/support/solutions/articles/61000318020-arive-release-notes-v2026-3-0-0)
- External document sharing is a plan feature — [Arive Pricing](https://arive.com/pricing)
- Document deletion is permanent ("cannot be recovered by user") [pre-2026] — [v2024.5.0.0](https://support.arive.com/support/solutions/articles/61000312763-arive-release-notes-v2024-5-0-0)

**Credit, AUS and verifications**
- Arive integrates with "over 30 top credit vendors including Advantage Credit, Xactus", and credit is ordered from the loan file — [ARIVE Integrations page](https://www.arive.com/watch-demo); [Arive support credit article](https://support.arive.com/support/solutions/articles/61000273105)
- Announced credit integrations include Factual Data and Avantus [pre-2026, 2019] — [BusinessWire: Factual Data](https://www.businesswire.com/news/home/20190930005094/en/Factual-Data%C2%AE-Announces-Credit-Integration-ARIVE-LLC); [MPA: Avantus](https://www.mpamag.com/news/avantus-integrates-with-arives-mortgage-platform-for-independent-brokers-179828.aspx). CIS also completed an integration — [Xactus: CIS completes Arive integration](https://xactus.com/cis-completes-arive-integration/)
- AUS: there is a Dual AUS tab with Run DO, Run LPA and One-Click AUS. Running it requires DU/LPA credentials in settings, credit on the file and a priced loan with a product applied. DU findings release to the lender when Interim or Final is selected. LPA findings must be released in Freddie's portal. FHA lender ID must be confirmed with the lender — [Run AUS (DU and LPA)](https://support.arive.com/support/solutions/articles/61000273604-run-aus-du-and-lpa-); [ARIVE.Next v2.6 (one-click AUS)](https://support.arive.com/support/solutions/articles/61000295240-arive-next-release-notes-v2-6)
- Title: Arive can "find local title companies and import their fees directly" — [ARIVE Integrations page](https://www.arive.com/watch-demo)
- VOE/VOI, flood and MI: I found no Arive-specific integration documentation in search results.

**E-sign**
- Built-in Arive E-Sign comes with Broker Pro, as an alternative to a linked DocuSign account. v7.2.0 added signing by LOAs, processors, business contacts and external recipients through a no-login link [date unclear]. v2024.6 added initials [pre-2026] — [v2024.6.0.0](https://support.arive.com/support/solutions/articles/61000313024-arive-release-notes-v2024-6-0-0); [v7.2.0](https://support.arive.com/support/solutions/articles/61000306850-arive-release-notes-v7-2-0)

**Reporting and analytics**
- Reports menu includes Call Reports (MCR) and state reports — [Generate Call Reports](https://support.arive.com/support/solutions/articles/61000281236-generate-call-reports-mcr-)
- I found no search-result detail on pipeline or business analytics dashboards.

**Compensation, commission and accounting**
- The MCR uses compensation fields (date, amount, payer) in the Loan Center — [Generate Call Reports](https://support.arive.com/support/solutions/articles/61000281236-generate-call-reports-mcr-)
- The Non-Del plan includes "funding and revenue management" and customizable margin management — [Non-Del plan features](https://support.arive.com/support/solutions/articles/61000285413-non-del-plan-features)
- I found no evidence of LO commission plans, payroll or referral-partner payouts in Arive.

**Licensing and user/role management**
- There are two seat types. The Originator seat is for NMLS-licensed LOs with full LOS/POS/PPE and unlimited pricing. The Support seat gives limited access for processors, assistants and admins. All users on a Company Paid subscription must share one tier and billing schedule (search snippet) — [Arive Pricing](https://arive.com/pricing); [Pricing and subscription overview](https://support.arive.com/support/solutions/articles/61000284776-arive-pricing-and-subscription-overview)
- Settings are split between Company Settings and User Settings (credentials, integrations) — [Run AUS](https://support.arive.com/support/solutions/articles/61000273604-run-aus-du-and-lpa-)

**Partner (realtor/referral) portals**
- There is a co-branded Real Estate Agent / Realtor Portal (a Core feature) with a customizable login URL — [MPA all-in-one](https://mpamag.com/us/specialty/technology/arive-highlights-all-in-one-platform-to-take-brokers-to-the-next-level/511539); [Arive Pricing](https://arive.com/pricing)
- I found no documentation of its detailed functions (status visibility, document upload, co-marketing).

**AI features**
- "Voice-to-Loan Transcoder", described as a "patent pending Generative AI tool" that turns speech into a mortgage application, was announced **April 1, 2025**. It may be an April Fools' item and is unverified — [Arive press, Apr 1 2025](https://www.arive.com/press/arive-unveils-voice-to-loan-transcoder-powered-by-generative-ai)
- I found no 2026 Arive AI announcement, and 2026 release notes surfaced in search are lender onboarding plus operational items.

**APIs and integrations**
- "Currently, we do not offer open/direct API integration." Zapier is a private, invite-only app limited to Broker Pro and Non-Del plans. Users generate a Client ID, Secret Key and API Key in the Settings Integrations tab — [How does Zapier integration work](https://support.arive.com/support/solutions/articles/61000312645-how-does-zapier-integration-work-); [Integrate Arive with Zapier (CRM)](https://support.arive.com/support/solutions/articles/61000306081-integrate-arive-with-your-zapier-account-crm-integration-)
- A third-party integrator calls the Zapier-only model a limitation for CRM sync and conversion tracking (vendor with an interest in the claim) — [Proven ROI: Arive integration limitations](https://www.provenroi.com/blog/arive-integration-limitations-cro-impact-and-the-best-alternatives-for-scalable-growth)

**Independent reviews**
- I found no G2 or Capterra profile with ratings for Arive. SourceForge and Slashdot comparisons show "No User Reviews." For contrast, LendingPad shows 4.7 from 168 reviews on G2 (search snippet) — [Slashdot: ARIVE vs Morty](https://slashdot.org/software/comparison/ARIVE-vs-Morty/); [G2 LOS listing](https://www.g2.com/products/los/reviews)

### Inferences
- Arive's real moat is the PPE and integrated lender marketplace: rate sheets from wholesale residential lenders plus electronic registration and submission. Nearly every 2026 press release is a lender onboarding.
- The thin open-integration story (Zapier only, no REST API) means Arive is hard to embed into a custom stack. A firm with its own platform would not use it as a back end.

### Gaps
- No Arive page was opened directly. Pricing figures, the realtor portal's functions, CRM campaign features, analytics dashboards and the full credit vendor list need verification on arive.com and support.arive.com (whitelist those domains).
- HMDA LAR export, VOE/VOI, flood, MI and generic conditions tracking were not confirmed or refuted.
- Release notes after v2026.3 (Apr 2026) were not found.

---

## 2. How does Arive handle the broker workflow end to end?

### Takeaway
The stitched-together flow, inferred from search snippets, runs like this. Lead in the CRM. Application in the POS. Credit pull from the loan file. Pricing and quotes in the PPE. AUS via DU/LPA. Disclosures via DocMagic. Registration and submission to an integrated lender. Lender-specific conditions exchange. Closing docs via DocMagic and e-sign. Compensation fields recorded for the MCR. Funding and revenue management exists only in the Non-Del plan, and broker commission accounting is not evidenced.

### Cited Findings
- **Lead and CRM:** CRM is integrated in the LOS. External CRMs (HubSpot) connect via Zapier — [NAMB directory](https://irp.cdn-website.com/f3cf809c/files/uploaded/NAMB+Technology+Partner+Directory+8.5+x+11.pdf); [Zapier integration](https://support.arive.com/support/solutions/articles/61000306081-integrate-arive-with-your-zapier-account-crm-integration-)
- **Application:** The borrower POS takes consumer loan applications — [What is Arive](https://support.arive.com/support/solutions/articles/61000271217-what-is-arive-)
- **Credit:** Ordered or reissued from the loan file through 30+ vendors — [Integrations](https://www.arive.com/watch-demo)
- **Pricing:** The PPE compares lenders, builds quotes and fee worksheets, and qualifies products. A priced loan with a product applied is a prerequisite for AUS — [What is Arive](https://support.arive.com/support/solutions/articles/61000271217-what-is-arive-); [Run AUS](https://support.arive.com/support/solutions/articles/61000273604-run-aus-du-and-lpa-)
- **AUS:** One-click DU/LPA, with DU findings released to the lender from Arive — [Run AUS](https://support.arive.com/support/solutions/articles/61000273604-run-aus-du-and-lpa-)
- **Disclosures:** LE, initial disclosures, COC, CD and closing package through DocMagic — [Arive support: DocMagic](https://support.arive.com/en/support/solutions/articles/61000308107)
- **Lender submission:** Electronic registration with integrated lenders. Rocket Pro brought "pricing and submission into ARIVE" — [HousingWire: Rocket Pro](https://www.housingwire.com/articles/rocket-pro-tpo-joins-arive-platform/)
- **Conditions:** Lender-specific, for example JMAC (view, upload, submit conditions) — [JMAC help](https://help.jmaclending.com/hc/en-us/articles/50989320206099-Managing-Conditions-in-ARIVE)
- **Closing and e-sign:** DocMagic closing package plus Arive E-Sign or DocuSign — [DocMagic article](https://support.arive.com/en/support/solutions/articles/61000308107); [v2024.6.0.0](https://support.arive.com/support/solutions/articles/61000313024-arive-release-notes-v2024-6-0-0)
- **Funding and compensation:** Compensation date, amount and payer recorded in the Loan Center. "Funding and revenue management" is listed for the Non-Del plan — [MCR article](https://support.arive.com/support/solutions/articles/61000281236-generate-call-reports-mcr-); [Non-Del features](https://support.arive.com/support/solutions/articles/61000285413-non-del-plan-features)

### Inferences
- The workflow is linear and lender-integrated for agency, government and non-QM residential products. Each step assumes a 1003-style borrower file and rate-sheet pricing. That differs from Kubera's flow, where the broker packages a deal, shops it to lenders that issue bespoke term sheets, compares quotes, and then manages third-party reports and closing.
- The steps that carry over conceptually: a single deal record, a doc vault with classification and finalize-lock, task assignment and auto-complete, quote comparison, lender submission with status and conditions sync, e-sign, and compensation capture.

### Gaps
- I found no documentation of milestone/pipeline stage definitions, automated borrower status notifications, or a post-closing commission or accounting module for broker plans.

---

## 3. What does Arive charge and who is its target user? Any commercial or business-purpose support?

### Takeaway
Per-seat SaaS pricing roughly $50–$100 per originator per month (exact figures unverified), across Broker Core, Broker Pro and Non-Del tiers, aimed at NMLS-licensed independent residential brokers. Business-purpose support stops at residential investor loans: DSCR non-QM, a DSCR calculator and a 5–10 unit multifamily property type. There is no commercial real estate, SBA, HUD or CMBS support.

### Cited Findings
- **Pro seats:** Originator seat about $79.99/user/mo monthly or $69.99 billed yearly. Support seat about $39.99 monthly or $34.99 yearly. A $99.99 figure also appears with an unclear tier. The search tool said the page text was jumbled — [Arive Pricing](https://arive.com/pricing)
- **Core seat:** $59.99 month-to-month or $49.99/mo annual. SourceForge lists from $49.99/user/mo annual — [Arive Pricing](https://www.arive.com/pricing); [SourceForge](https://www.sourceforge.net/software/product/ARIVE)
- **Conflicting price data:** another directory says plans start at $150/month, and the Non-Del seat appears as $99.95 or other garbled figures. Treat these as unverified — [search summary citing directory listings](https://www.goodfirms.co/software/arive); [Arive Pricing](https://www.arive.com/pricing)
- **Core features (per pricing-page snippet):** call reports, Realtor Portal, Zapier APIs, built-in e-signing, LOS white-labeling, POS themes, external document sharing. Other snippets attribute Zapier and e-sign to Broker Pro only, so the tier split is inconsistent — [Arive Pricing](https://www.arive.com/pricing); [Zapier support](https://support.arive.com/support/solutions/articles/61000312645-how-does-zapier-integration-work-)
- **Annual discount:** applies to Core and Pro, but not Non-Del — [Pricing overview (support)](https://support.arive.com/support/solutions/articles/61000284776-arive-pricing-and-subscription-overview)
- **Non-Del plan (for non-delegated correspondents):** all Broker Pro features plus MERS MIN generation, automatic Non-Del pricing with integrated lenders, Non-Del and broker loans in one account, margin management, an updated fees worksheet, DocMagic, call reports, and funding and revenue management — [Non-Del plan features](https://support.arive.com/support/solutions/articles/61000285413-non-del-plan-features); [Non-Del pilot, May 2021](https://www.arive.com/press/arive-launches-non-delegated-pilot-program) [pre-2026]
- **Target user:** independent mortgage brokers. The Originator seat is for NMLS-licensed loan officers — [Arive Pricing](https://arive.com/pricing); [MPA all-in-one](https://mpamag.com/us/specialty/technology/arive-highlights-all-in-one-platform-to-take-brokers-to-the-next-level/511539)
- **DSCR / business purpose:** in v2026.2, auto-DSCR calculation and a "Multi-Family (5–10 Units)" property type for Non-QM — [v2026.2.0.0](https://support.arive.com/support/solutions/articles/61000317947-arive-release-notes-v2026-2-0-0)
- **Broker DSCR setup:** mortgage type Non-QM, doc type DSCR. DSCR investment loans are "typically business purpose", with a business-purpose checkbox and advice to check with compliance — [Coast2Coast help: DSCR setup in ARIVE](https://coast2coastml-help.freshdesk.com/support/solutions/articles/158000442336-dscr-dscr-loan-setup-in-arive)
- **Non-QM / investor lenders on Arive:** Oaktree (DSCR), HomeXpress (investor), JMAC (Investor DSCR), Kind Lending — [Oaktree](https://www.arive.com/press/oaktree-funding-corp-joins-the-arive-platform-expanding-broker-access-to-flexible-non-qm-lending-solutions); [JMAC on Arive](https://www.jmaclending.com/arive); [MPA: Kind Lending non-QM on Arive](https://mpamag.com/us/specialty/non-prime/kind-lendings-non-qm-loans-go-live-on-arive-broker-platform/499143)
- Business-purpose investment-property loans are excluded from Arive's MCR (since Q1 2024) — [MCR article](https://support.arive.com/support/solutions/articles/61000281236-generate-call-reports-mcr-)
- I found no Arive source supporting commercial property types (hotel, senior housing, 11+ unit multifamily), SBA, HUD/FHA multifamily (223(f)/232), CMBS or bridge — search returned nothing Arive-specific — [search: Arive commercial](https://pro.janover.co/guides/broker-guide-to-financing-1-4-unit-residential) (general context only, not about Arive)

### Inferences
- Arive's "commercial" reach is residential-investor DSCR on 1–4 units, plus 5–10 unit multifamily for non-QM. That overlaps with none of Kubera's core programs (HUD 232/223(f), SBA 504/7(a), hotel CMBS, PIP bridge, agency multifamily, private bridge), except possibly small-balance multifamily.
- At about $50–$80 per seat, the price is low. Kubera would still get nothing from the PPE (no CRE rate sheets) and would have to fight a 1003/TRID-centered data model. Adopting Arive is not sensible. Its value to Kubera is as a UX and workflow reference.

### Gaps
- Exact current pricing and tier composition need confirmation on arive.com/pricing (fetch blocked).
- Whether Arive's data model can hold an entity borrower (LLC) with guarantors was not confirmed.

---

## 4. Which Arive features are residential-only and not needed for business-purpose commercial loans?

### Takeaway
TRID disclosures (LE, CD, COC via DocMagic), DU/LPA AUS, FHA lender IDs, HMDA, the NMLS MCR, MERS MIN generation, rate-sheet PPE and lock or registration with residential wholesale lenders, and the 1003 consumer POS are all residential consumer-mortgage tooling that Kubera does not need. Kubera's equivalents are California DRE broker disclosures and commercial term sheets.

### Cited Findings
- DocMagic produces the LE, initial disclosures, COC, CD and closing package. These are TRID documents for consumer mortgages — [Arive DocMagic article](https://support.arive.com/en/support/solutions/articles/61000308107); [DocMagic TRID history](https://blog.docmagic.com/docmagic-releases-new-trid-functionality-to-its-entire-client-base-and-all-los-vendors) [pre-2026]
- DU/LPA AUS is Fannie and Freddie single-family underwriting. Arive needs agency credentials and a priced residential product — [Run AUS](https://support.arive.com/support/solutions/articles/61000273604-run-aus-du-and-lpa-)
- The MCR is an NMLS residential filing, and Arive itself excludes business-purpose investment loans from it — [MCR article](https://support.arive.com/support/solutions/articles/61000281236-generate-call-reports-mcr-)
- MERS MIN generation (Non-Del) applies to residential notes registered on MERS — [Non-Del features](https://support.arive.com/support/solutions/articles/61000285413-non-del-plan-features)
- The Coast2Coast guide notes the business-purpose flag on DSCR loans, which changes which consumer disclosures apply. It advises checking with compliance — [Coast2Coast DSCR setup](https://coast2coastml-help.freshdesk.com/support/solutions/articles/158000442336-dscr-dscr-loan-setup-in-arive)

### Inferences
- TRID and Reg Z do not apply to business-purpose credit, and HMDA reporting does not apply to a broker that is not the lender. Neither applies to Kubera. This is general regulatory knowledge, not from the sources above; verify with counsel.
- Kubera's analogous compliance layer is California DRE broker obligations: broker disclosures under the Business & Professions Code, trust-fund rules if it handles deposits, and any DRE activity reporting. These are not covered by Arive and are not sourced here. Flag them for counsel review and do not treat them as findings.
- Non-residential features that do transfer: e-sign with external signers, document classification and finalize-lock (audit trail), consent/eSign tracking, task assignment and auto-complete, partner portal, quote comparison, and the lender submission and conditions pattern.

### Gaps
- I did not confirm whether Arive offers any non-TRID, business-purpose disclosure set.

---

## 5. Relevance matrix: Arive feature vs. Kubera Commercial (has / plans / build-or-integrate)

### Takeaway
About half of Arive's surface (TRID, AUS, MCR, HMDA, MERS, residential PPE, 1003 POS) is irrelevant to Kubera. The relevant half (pipeline and tasks, doc vault with classification, conditions sync, e-sign, partner portal, quote comparison, lender submission, compensation tracking) is mostly already planned in Kubera's roadmap. The main unplanned gaps are a lender-agnostic conditions tracker, a commission/fee ledger, a doc finalize-lock with audit trail, and a white-label or co-branded partner view with status updates.

### Cited Findings
- Arive feature facts in this matrix are cited in sections 1–4 above. Kubera status comes from the assignment brief (internal context), not from external sources.

### Inferences
"Has" and "Planned" come from the brief. "Build/integrate" is my recommendation.

| Arive module / feature | Relevant to Kubera? | Kubera status | What Kubera would build or integrate |
|---|---|---|---|
| Lead capture + CRM (contacts, notes, loan history) | Yes | **Has**: Twenty CRM sync (person, company, opportunity, notes). **Planned**: Twenty automation agents | Add deal-stage history and loan-amount change tracking on the opportunity (Arive tracks "loan amount history") |
| Marketing automation (email/SMS from milestones; via HubSpot/Zapier in Arive) | Yes | **Planned**: Zoho, Resend, Telnyx, newsletter, consent ledger | Milestone-triggered borrower and referrer notifications from pipeline stage changes, gated by the consent ledger |
| Borrower POS / 1003 application | Partly (concept only) | **Has**: 60-second qualifier, loan sizer, AI advisor. **Planned**: borrower portal | No 1003. Build a CRE intake: sponsor/entity, guarantors, property, T-12, rent roll, STR, PIP budget. AI doc agent (planned) pre-fills it |
| Configurable/white-label POS themes, custom login URLs | Low | n/a (single brand) | Skip, unless offering co-branded portals to referral brokers |
| PPE: rate-sheet pricing across wholesale lenders | Concept yes, mechanism no | **Has**: loan sizer + Jev rules engine (program pick) | No CRE rate sheets exist. Keep a sizer on indicative program terms (HUD/SBA/CMBS spreads) refreshed by staff. Real pricing comes from lender term sheets |
| Lender marketplace (lender onboarding, products) | Yes (as lender directory) | **Has**: static lender list, partner registration with lender credit boxes. **Planned**: matching against credit boxes | Structured credit-box schema (asset type, geography, LTV/DSCR, loan size, recourse, program), match scoring, lender response tracking |
| Quote comparison / fee worksheet | Yes | **Has**: sizer fee breakdowns, AI-drafted indicative term sheets. **Planned**: term-sheet parsing into quote comparison | Normalized quote schema (rate, index/spread, IO, amortization, prepay, fees, reserves, recourse) and a side-by-side comparison view |
| Electronic registration / submission to lender | Yes (as package delivery) | **Planned**: loan package / OM generation, approval queue | Submission log per lender (sent date, package version, NDA, status, decline reason). Delivery by email or secure data-room link, since there is no lender API |
| Lender-specific conditions exchange (e.g. JMAC) | Yes | Not explicit. **Planned**: doc-chasing and closing-checklist agents | Lender-agnostic conditions tracker per deal (condition text, owner, due date, linked docs, cleared-by). Feed it into doc-chasing agent |
| Credit pull (30+ vendors) | Low–medium | None | Commercial lenders pull credit themselves. Optional: guarantor soft pull or background vendor later. Not a priority |
| VOE/VOI, MI | No | n/a | Not needed for business-purpose CRE |
| Flood, title fees | Partly | **Planned**: vendor order tracking (appraisal, Phase I) | Extend vendor tracking to title, flood, PCA, survey, zoning, PIP and franchise reports, plus HUD- or SBA-required third-party reports |
| DU/LPA AUS | No | n/a | Not applicable. Kubera's equivalent is the Jev classification/program rules plus lender credit-box matching |
| TRID disclosures (LE/CD/COC via DocMagic) | No | n/a | Instead, a CA DRE broker disclosure and fee agreement template set, signed via DocuSign (planned). Verify required forms with counsel |
| HMDA LAR | No | n/a | Not applicable to a business-purpose broker (verify with counsel) |
| NMLS MCR / state reports | No (NMLS); maybe DRE reporting | n/a | Check whether any DRE activity report applies. If so, build an export from the pipeline DB |
| MERS MIN / Non-Del funding | No | n/a | Kubera does not fund loans |
| Document management: folders, classification, finalize-lock, external sharing | Yes | **Has**: Supabase vault with signed uploads. **Planned**: AI doc agent extraction | Add doc taxonomy per program (HUD 232 vs SBA vs CMBS checklists), versioning, a finalize/lock state with an immutable audit log, and expiring external share links for lenders |
| Tasks: assignment, auto-completion; Global Notes with pinning | Yes | **Planned**: staff login, pipeline dashboard, closing-checklist agent | Task model tied to deal stage, with auto-complete when a linked doc or condition clears, and pinned notes |
| Milestone / pipeline management | Yes | **Planned**: broker pipeline dashboard + approval queue | Program-specific stage templates. HUD and SBA timelines differ sharply from bridge |
| E-sign (built-in or DocuSign; external no-login signers; initials) | Yes | **Planned**: DocuSign | Integrate DocuSign with status webhooks into the deal record and consent ledger. Support external signers (guarantors, sponsors) |
| Reporting / analytics | Yes | **Planned**: insights | Pipeline funnel, lender hit-rate, time-in-stage and fee-revenue reports |
| Compensation / commission (comp fields; Non-Del revenue mgmt) | Yes | Not in brief | Gap. Build a fee ledger per deal (broker fee %, lender-paid vs borrower-paid, referral splits to partner brokers, invoice and paid status) |
| Seats / roles (Originator vs Support) | Yes | **Planned**: staff login | RBAC roles: principal/broker of record, analyst/processor, partner, borrower. Record DRE license per user, since the DRE broker of record must supervise |
| Realtor / referral partner portal (co-branded) | Yes | **Has**: partner registration form. **Planned**: partner portal | Referral-broker view showing referred deals' status, required docs and fee split. Lender view of matched deals |
| AI (Voice-to-Loan, 2025, possibly April Fools') | Kubera ahead | **Has**: Claude advisor and term-sheet drafting. **Planned**: doc agent, CRM agents, conversation logs | No Arive AI to copy. Kubera's AI roadmap already exceeds anything found for Arive |
| API / integrations (Zapier only, no open API) | Lesson | **Has**: direct Twenty and Supabase integrations | Keep first-party APIs and webhooks. Arive's Zapier-only model is a criticized limitation |

### Gaps
- Kubera's "has" and "planned" statuses are taken from the brief and were not checked against the repo code.
- California DRE-specific disclosure and reporting obligations for commercial loan brokerage were not researched here. They need counsel or separate research.
