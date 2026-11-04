# LendingPad (lendingpad.com): Feature Inventory and Relevance to Corin Commercial

> **Method and source caveat (read first).** Direct page fetches failed from this environment: `www.lendingpad.com` and `ainora.lt` both returned DNS failures (hosts outside the session's allowed network domains). **Every finding below comes from web-search result snippets and search-engine summaries of pages, not from pages I opened.** That includes the LendingPad knowledge base (kb.lendingpad.com / lendingpad.com/kb), its blog/press releases, and review sites. Treat specifics (prices, setup steps, field names) as needing confirmation from the vendor. To verify, allow `lendingpad.com`, `kb.lendingpad.com` and `blog.lendingpad.com` in the session's network settings and re-run. Research date: 2026-10-31. Items dated before 2025 are marked **[older]**.

---

## 1. What modules does LendingPad offer, and what is in each? (Feature inventory by module)

### Takeaway
LendingPad (WEI Technology LLC, McLean VA) is a cloud, browser-based **residential mortgage** LOS sold in two editions: a per-user **Broker Edition** and a per-closed-loan **Lender/Institution Edition** that adds secondary, funding, post-closing and multi-channel (retail/wholesale/correspondent) functions. Its distinctive asset is a native broker-to-wholesale-lender network ("Register with Lender") plus a growing set of direct lender integrations (UWM, Mutual of Omaha; Phase 1 announced April 2026). It ships no AI of its own as of 2026. AI comes only through partners.

### Cited Findings

**Company / editions**
- LendingPad is a product of WEI Technology LLC, headquartered in McLean, VA. — [search summary of LendingPad about-us / ZoomInfo](https://lendingpad.com/about-us)
- It positions itself as a cloud-based LOS "built for brokers" that offers centralized, automated technology. — [MPA Mag review](https://www.mpamag.com/us/mortgage-broker-software/lendingpad-review/445438)
- Two editions. **Broker Edition** for brokerages. The higher **Lender/Institutions** tier adds "secondary, funding and post closing functions with an unlimited number of users", full channels (retail, direct, wholesale, correspondent), APIs, and phone support. It also covers administration of third-party channels and "complete secondary tasks with institutional investors." — [LendingPad lenders page (snippet)](https://lendingpad.com/solutions/lenders); [MPA Mag](https://www.mpamag.com/us/mortgage-broker-software/lendingpad-review/445438); [Software Advice profile](https://www.softwareadvice.com/loan-origination/lendingpad-profile/)
- It also supports Hybrid / Non-Delegated Correspondent operation. A KB guide covers it and says the investor should approve the final Closing Disclosure and closing package before closing. — [KB: Guide for Hybrid or NDC](https://kb.lendingpad.com/guide-to-operate-hybrid-/-non-delegated-correspondent-company-on-lendingpad)

**LOS core / workflow / pipeline / milestones**
- Statuses (milestones) **advance automatically** from dates and times entered in the file, rather than being set by hand. — [KB: Getting Started](https://kb.lendingpad.com/getting-started-in-lendingpad)
- Anything before an application is a **Lead**. Entering an "Application Taken" date moves the file into **Pipeline**. — [KB: How to change a loan status](https://lendingpad.com/kb/how-to-change-a-loan-status-in-lendingpad)
- Active pre-closing statuses include "Registered (with Lender)", "Broker Condition Submission", "Condition Submission" and "Clear to Close". "Closing" and "Funding" fall in the after-closing group. — [KB: How to change a loan status](https://kb.lendingpad.com/how-to-change-a-loan-status-in-lendingpad); [KB: LendingPad Statuses](https://kb.lendingpad.com/lendingpad-statuses)
- The dashboard shows task counts with due-today and overdue views (from a vendor demo video, per search summary). — [search summary citing vendor demo](https://kb.lendingpad.com/getting-started-in-lendingpad)
- Role-based edit locks by status: "a common control would be to lock out LO's from editing 1003, Fee screens from Processing status and onward." — [KB: Getting Started](https://kb.lendingpad.com/getting-started-in-lendingpad)
- Simplified UI release (January 2025): streamlined workflows and "smart shortcuts" to reduce clicks. It is automation and UI work, not AI. — [LendingPad press release](https://blog.lendingpad.com/news-and-press-releases/lendingpad-revolutionizes-mortgage-processing-with-next-generation-simplified-ui-release)
- Listed features: CRM, document archiving, compliance check, custom workflows, real-time updates, loan tracking, lead and campaign management, service level agreements. — [Software Advice profile](https://www.softwareadvice.com/loan-origination/lendingpad-profile/); [MPA Mag](https://www.mpamag.com/us/mortgage-broker-software/lendingpad-review/445438)

**Conditions / underwriting**
- Underwriters can add single conditions, or batch conditions picked from pre-configured batches (vendor demo, per search summary). — [search summary](https://kb.lendingpad.com/getting-started-in-lendingpad)
- Conditions from a direct-integrated lender (UWM) sync back into the file. UWM-sourced conditions **cannot be edited or cleared** in LendingPad. — [KB: UWM portal API keys](https://kb.lendingpad.com/how-to-obtain-personal-api-keys-for-the-uwm-portal)

**POS / borrower portal**
- A **complimentary LendingPad POS** is included, with partner POS options (Floify, LOANZIFY). The KB covers "How to Setup POS" and turning on credit in the POS. — [MPA Mag](https://www.mpamag.com/us/mortgage-broker-software/lendingpad-review/445438); [KB: How to Setup POS](https://kb.lendingpad.com/how-to-setup-pos)
- Users rate the native POS as **basic and not user-friendly**. Some prefer Floify. Reviewers also cite duplicate borrower accounts and borrower login trouble. — [GetApp reviews](https://www.getapp.com/finance-accounting-software/a/lendingpad/reviews/); [Capterra](https://www.capterra.com/p/171891/LendingPad/pricing/)
- Floify integration: starting a Floify loan flow creates the LendingPad loan file, and milestones sync. — [Floify help: LendingPad](https://help.floify.com/en/articles/15141356-lendingpad); [Floify: LendingPad Milestone Sync](https://help.floify.com/hc/en-us/articles/360059441311)

**CRM**
- The LOS "fulfills the role of a CRM" with lead tools and campaign management. The KB has a "connecting your CRM" topic. — [MPA Mag](https://www.mpamag.com/us/mortgage-broker-software/lendingpad-review/445438); [KB: System Overview](https://kb.lendingpad.com/system-overview)
- Reviewers report a **lack of CRM and realtor-portal integrations** as a weakness. — [Capterra](https://www.capterra.com/p/171891/LendingPad/pricing/)
- Virtual branches (groupings of people) can be built through Lead Provider or Campaign structures. — [KB: Settings](https://kb.lendingpad.com/settings)

**Pricing engines (PPE) and lock / secondary**
- **Optimal Blue PPE**: a multi-point integration lets lenders generate pricing scenarios inside LendingPad. LendingPad calls the OB API for up to four pricing views (BestEx, Complete Product Search, Complete Product Search with QM, Product Group). The integration guide is dated March 5, 2025. The original Black Knight announcement is **[older]**, pre-ICE acquisition. — [Black Knight announcement](https://www.blackknightinc.com/lendingpad-integrates-with-black-knights-optimal-blue-ppe-to-streamline-loan-origination-process/); [OB–LendingPad API guide PDF](https://lendingpad.com/hubfs/Introduction%20to%20Optimal%20Blue%20LendingPad%20API%20_%20Loan%20Services%20Integration%20(7).pdf?hsLang=en)
- **Loansifter** (Optimal Blue's broker PPE): brokers can take an application through LendingPad with real-time product and pricing. **[older]** — [LendingPad blog](https://blog.lendingpad.com/news-and-press-releases/loansifter-black-knights-broker-ppe-solution-integrated-with-lendingpad-los)
- **Polly** pricing and eligibility engine (March 4, 2025): pricing automation and lock-desk management. — [LendingPad press release](https://blog.lendingpad.com/news-and-press-releases/lendingpad-enhances-pricing-automation-through-strategic-integration-with-polly)
- **LoanNEX** (non-QM product and eligibility marketplace): LendingPad users get access to non-QM products and eligibility tools, including LoanNEX's Broker Marketplace (date not captured). — [LoanNEX blog](https://loannex.com/blog/loannex-and-lendingpad-partner-to-create-the-most-comprehensive-access-to-non-qm-products/); [MPA Mag](https://www.mpamag.com/us/specialty/non-qualified-mortgage-loan/non-qm-platform-loannex-integrates-with-lendingpad/424952)
- A native "LendingPad pricing engine" is referenced in the POS setup guide. Its scope is not documented in what I found. — [KB: How to Setup POS](https://kb.lendingpad.com/how-to-setup-pos)
- **MCT** secondary integration (September 2025). Phase 1 exports loan data by API to MCT. Phase 2 (slated late 2025 or early 2026) returns loan-sale commitment data. — [EIN Presswire](https://www.einpresswire.com/article/850719804/lendingpad-mct-announce-strategic-integration-to-streamline-secondary-market-operations)
- Lender Price is listed only on a SourceForge directory page. **Unconfirmed.** — [SourceForge](https://www.sourceforge.net/software/compare/Lender-Price-vs-LendingPad)
- I found no LendingPad-specific lock desk documentation. — (gap; see search summary above)

**Lender / investor connectivity (wholesale network)**
- **Native LP-to-LP network:** the broker and a LendingPad-hosted wholesale lender must be "connected" first. The lender emails LendingPad support to approve the connection. The broker then picks lender and program under Wholesale Lender Information and clicks **"Register with Lender."** This creates a copy of the application in the lender's pipeline, which appears as a clone in the broker's pipeline. — [KB: LP Brokers operating with LP Wholesale Lenders](https://kb.lendingpad.com/lendingpad-brokers-operating-with-lendingpad-wholesale-lenders)
- Once registered, the broker **can no longer modify** the file. Uploading to the original application does **not** reach the lender. Disclosure fee details do **not** carry over to the lender's file. LO and processor must be assigned before registration. — [same KB](https://lendingpad.com/kb/lendingpad-brokers-operating-with-lendingpad-wholesale-lenders); [KB: TPO Broker Guide](https://www.lendingpad.com/kb/tpo-broker-guide); [Emporium TPO broker guide PDF](https://emporiumtpo.com/assets/downloads/broker-lp-user.pdf)
- **Phase 1 Lender Integrations (April 16, 2026):** direct loan registration and **real-time underwriting-condition syncing** for wholesale and investor pipelines. UWM is among the first partners, and more are planned. — [LendingPad press release](https://blog.lendingpad.com/news-and-press-releases/lendingpad-releases-first-phase-of-lender-integrations-to-centralize-wholesale-and-investor-workflows); [NatLawReview copy](https://natlawreview.com/press-releases/lendingpad-releases-first-phase-lender-integrations-centralize-wholesale-and)
- **UWM** has two paths (KB, about April 20, 2026). (a) A legacy third-party UWM Portal: MISMO refresh every few hours, and no documents, statuses or conditions come back. (b) The new direct integration: the loan number is assigned immediately, and MISMO data plus UW conditions return to the file. **Documents and statuses are not yet supported.** — [KB: UWM API keys](https://kb.lendingpad.com/how-to-obtain-personal-api-keys-for-the-uwm-portal)
- **Mutual of Omaha Mortgage TPO** integration: on registration, loan data **and documents** go to MOO, and later uploads auto-export. The company and LO must be registered with MOO. Date not captured, likely 2026. — [KB: LendingPad and Mutual of Omaha](https://lendingpad.com/kb/lendingpad-and-mutual-of-omaha-integration.-); [press release](https://blog.lendingpad.com/news-and-press-releases/lendingpad-launches-mutual-of-omaha-mortgage-tpo-integration-to-enhance-broker-loan-submissions)
- **Kind Lending** strategic partnership for brokers (August 13, 2025). — [EIN Presswire](https://www.einnews.com/pr_news/838172375/lendingpad-kind-lending-announce-strategic-partnership-to-deliver-enhanced-technology-experience-for-mortgage-brokers)
- **Lendz Financial** (a non-QM wholesaler) runs on LendingPad and integrated its wholesale channel. — [Lendz news](https://lendzfinancial.com/news/lendz-and-lendingpad-further-integration-through-wholesale-channel)

**Disclosures and compliance**
- Initial disclosure package: the system auto-selects documents by loan type and state. — [KB: Getting Started](https://kb.lendingpad.com/getting-started-in-lendingpad)
- **ComplianceEase** integration: real-time regulatory compliance audits without leaving the LOS. **[older, 2019]** — [ComplianceEase press release](https://blog.lendingpad.com/press-releases/complianceease-announces-integration-with-lendingpad); [KB: FAQs (setup article)](https://kb.lendingpad.com/faqs)
- HMDA report export, Call Report, and NMLS Mortgage Call Report (MCR) filing articles exist. — [KB: FAQs](https://kb.lendingpad.com/faqs)
- Selecting a lender in Summary switches the origination channel to **broker** for NMLS reporting. With no lender, the file defaults to a lender/banked loan. — [KB: Getting Started](https://kb.lendingpad.com/getting-started-in-lendingpad)
- A "Quality Control" user role exists in the Broker Edition. — [KB: List of Broker Edition User Roles](https://kb.lendingpad.com/list-of-broker-specific-user-roles)
- I found no explicit documentation of an audit-trail or field-change-history feature. (gap)

**Credit / AUS / verifications**
- AUS: DU, DO, LP and LPA. The KB has troubleshooting, DU redistribution, and "AUS – Freddie Mac's LPA Action" setup articles. — [KB: FAQs](https://kb.lendingpad.com/faqs)
- Credit reports run on user-level or company-level credentials (Actions / Credit Report). — [KB: FAQs](https://kb.lendingpad.com/faqs)
- An "Integrated Vendors List" KB page publishes vendor integration timelines. — [KB: Getting Started](https://kb.lendingpad.com/getting-started-in-lendingpad); [KB: Integrations](https://kb.lendingpad.com/integrations)

**E-sign / documents**
- Native **DocuSign**: **$2.50 per envelope**, charged to the subscription card. Enterprise accounts can use their own DocuSign account. Company-level DocuSign credentials have been supported since 11/7/2025. — [KB: DocuSign eSign Instructions](https://kb.lendingpad.com/docusign-esign-instructions)
- A document management / archiving system (DMS) is built in. — [MPA Mag](https://www.mpamag.com/us/mortgage-broker-software/lendingpad-review/445438)

**Roles, permissions, licensing, branches, compensation**
- Broker Edition roles: Branch Manager, Loan Assistant, Loan Officer, Loan Processor, Loan Processor Manager, Quality Control, System Administrator (≤2 recommended). LOs, assistants and processors see only assigned files. — [KB: Broker Edition User Roles](https://kb.lendingpad.com/list-of-broker-specific-user-roles)
- Permissions are set per role (Settings > Users > User roles > Loans tab). Report and dashboard visibility is set separately. — [KB: How to set user role permissions](https://lendingpad.com/kb/how-to-set-user-role-permissions)
- Branches hold address, **branch-licensing enforcement**, members and **compensation amounts**. Broker records hold allowed loan types and compensation amounts. — [KB: Settings](https://kb.lendingpad.com/settings)
- "How to update NMLS licenses automatically?" is a KB article. — [KB: FAQs](https://kb.lendingpad.com/faqs)
- Broker compensation is lender-paid or borrower-paid, entered in the lock/lender section, with a toggle to sync it to the disclosure screen. — [search summary of KB / Emporium guide](https://emporiumtpo.com/assets/downloads/loan-submission-new-old-view.pdf)

**Reporting**
- Custom reports ("How to create a report?") and dashboards, with role-based visibility. — [KB: Custom reports](https://kb.lendingpad.com/custom-reports)

**APIs / integrations**
- The API is gated to **Lender Edition clients under an executed API Agreement**. The support desk issues NDAs, keys and test-site access. There is **no self-serve developer portal** and no public webhook reference. — [APIs.io LendingPad](https://apis.io/providers/lendingpad/); [api-evangelist apis.yml](https://raw.githubusercontent.com/api-evangelist/lendingpad/refs/heads/main/apis.yml)
- Zapier "Loan Updated" instant trigger. It needs LendingPad API access and a webhook URL set in LendingPad API settings. This is a third-party listing and unverified. — [Zapier](https://zapier.com/apps/lendingpad/integrations/webhook)
- A Partners Marketplace page exists. SourceForge counts 16 integrations. — [LendingPad Partners Marketplace](https://lendingpad.com/partners-marketplace); [SourceForge](https://www.sourceforge.net/software/product/LendingPad/integrations)

**AI**
- LendingPad's own resources page says it is "evaluating where AI could responsibly add value". Any AI capabilities "will be rolled out thoughtfully, with an emphasis on reliability and compliance." That means **no shipped native AI** in what I found. — [LendingPad Resources](https://lendingpad.com/resources/)
- Third-party AI: **AI1 Technologies AI Lending Suite 2.0** (October 2, 2025), with predictive repayment scoring and native two-way integration with LendingPad LOS. — [TechIntelPro](https://techintelpro.com/news/finance/payments-and-wallets/ai1-technologies-ai-lending-suite-20-with-predictive-scoring)

**Support**
- Support runs 8am–8pm EST (vendor claim) and covers email, help desk, KB, phone and chat. Multilingual support is claimed in a 2022 release. — [LendingPad blog](https://blog.lendingpad.com/lending-pad-support); [Capterra](https://www.capterra.com/p/171891/LendingPad/)
- Reviewers report frequent login issues. — [Capterra](https://www.capterra.com/p/171891/LendingPad/pricing/)

### Inferences
- LendingPad's moat for brokers is **lender connectivity**: the LP-to-LP clone network, plus direct API registration and condition sync with large wholesalers. Even in 2026 the direct integrations are partial (UWM: no documents or statuses back). That signals how hard bi-directional broker–lender file exchange is even in standardized residential lending.
- The architecture is **file-centric and MISMO/1003-centric**. Lender exchange runs on MISMO data, fees map to LE/CD screens, and AUS runs against 1003 data. None of this maps onto a commercial deal (rent roll, T-12, STR, sponsor, entity structure).
- The gated API (Lender Edition only, NDA) means a broker on the Broker Edition has little programmatic access. That contrasts with Corin's API-first stack (Supabase, Twenty).

### Gaps
- No primary-page verification. All facts are from search snippets, because fetches to lendingpad.com and kb.lendingpad.com were blocked.
- There is no documentation on audit trail or change history, the native PPE's scope, lock-desk workflow, accounting or GL features, or SOC 2 / security certifications.
- I found no release notes or changelog. The full list of lenders on the native LP wholesale network, and how many there are, was not found.

---

## 2. How does LendingPad handle the broker workflow end to end, and how does a broker hand a file to a wholesale lender?

### Takeaway
Lead (CRM/POS) → 1003 application (the "Application Taken" date moves the file into pipeline) → pricing via Loansifter/Optimal Blue/Polly/LoanNEX → disclosures (auto-selected package, DocuSign) → **"Register with Lender"**, which clones the file to the lender's LendingPad instance or pushes it by API to UWM or Mutual of Omaha → conditions flow back (LP lenders, UWM direct) as "Broker Condition Submission" / "Condition Submission" statuses → Clear to Close → Closing → Funding. Broker compensation is lender-paid or borrower-paid and set per file, with branch and broker comp amounts in settings. Registration **locks the broker out of editing**, so the handoff is a one-way snapshot plus a condition loop.

### Cited Findings
- Lead stage: anything before application is a lead. An "Application Taken" date moves the file into Pipeline. — [KB: Change loan status](https://lendingpad.com/kb/how-to-change-a-loan-status-in-lendingpad)
- Application intake: native POS or Floify, which auto-creates the LendingPad file. — [Floify help](https://help.floify.com/en/articles/15141356-lendingpad); [MPA Mag](https://www.mpamag.com/us/mortgage-broker-software/lendingpad-review/445438)
- Pricing: Loansifter lets brokers take an application "on the go" with real-time product and pricing **[older]**. LoanNEX covers non-QM. — [LendingPad blog](https://blog.lendingpad.com/news-and-press-releases/loansifter-black-knights-broker-ppe-solution-integrated-with-lendingpad-los); [LoanNEX](https://loannex.com/blog/loannex-and-lendingpad-partner-to-create-the-most-comprehensive-access-to-non-qm-products/)
- Disclosures: the initial package is auto-selected by loan type and state. DocuSign costs $2.50 per envelope. — [KB: Getting Started](https://kb.lendingpad.com/getting-started-in-lendingpad); [KB: DocuSign](https://kb.lendingpad.com/docusign-esign-instructions)
- Handoff to an LP-hosted lender: connection approved by the lender via LendingPad support → select lender and program → "Register with Lender" → the file is cloned into the lender pipeline. Later uploads to the broker's original file do not transmit, and fee details do not carry over. — [KB](https://kb.lendingpad.com/lendingpad-brokers-operating-with-lendingpad-wholesale-lenders)
- Lender-specific broker guides (Emporium TPO) tell brokers to complete the file before registering, because "This will take away all edit access." — [Emporium PDF](https://emporiumtpo.com/assets/downloads/broker-lp-user.pdf)
- Handoff to UWM (direct, 2026): the loan number is assigned immediately, and MISMO data and UW conditions sync back. Documents and statuses are not yet supported. — [KB: UWM](https://kb.lendingpad.com/how-to-obtain-personal-api-keys-for-the-uwm-portal)
- Handoff to Mutual of Omaha: data and documents go on registration, and later documents auto-export. — [KB: Mutual of Omaha](https://lendingpad.com/kb/lendingpad-and-mutual-of-omaha-integration.-)
- Conditions and closing statuses: Registered (with Lender) → Broker Condition Submission → Condition Submission → Clear to Close → Closing / Funding. — [KB: Change loan status](https://kb.lendingpad.com/how-to-change-a-loan-status-in-lendingpad)
- Compensation: lender-paid or borrower-paid, entered in the lock/lender section and synced to disclosures. Branch and broker comp amounts live in settings. — [KB: Settings](https://kb.lendingpad.com/settings); [Emporium submission guide](https://emporiumtpo.com/assets/downloads/loan-submission-new-old-view.pdf)
- NMLS: selecting a lender marks the loan as brokered for MCR reporting. — [KB: Getting Started](https://kb.lendingpad.com/getting-started-in-lendingpad)

### Inferences
- The broker workflow assumes **one lender per file**: you register with a single wholesaler. There is no evidence of multi-lender marketing, side-by-side quote comparison of lender responses, or term-sheet negotiation. Commercial brokerage is the opposite: one deal is shopped to many capital sources and competing term sheets are compared. Corin's planned lender matching and term-sheet parsing have no LendingPad analogue.
- The condition loop (lender issues conditions → broker submits docs → clear to close) is the most transferable concept. It maps onto Corin's planned document-chasing and closing-checklist agents, keyed to lender commitment letters and HUD/SBA checklists.
- I found no evidence of commission/payout accounting after funding (invoicing lenders, splitting with referral brokers). LendingPad records comp amounts for disclosure, not for receivables.

### Gaps
- Post-funding steps for brokers (comp reconciliation, broker invoices to lender, referral-partner splits) were not documented in sources found.
- Whether conditions flow back for all LP-network lenders (versus only API-integrated ones) is not fully clear.

---

## 3. What does LendingPad charge, who is the target user, and does it support business-purpose / commercial loans?

### Takeaway
Target users are U.S. **residential** mortgage brokers, plus lenders, banks, credit unions and non-QM shops. Broker Edition is roughly **$40–$55 per user per month** in third-party listings. A 2019 vendor blog put it at $40–$100. Lender Edition is billed **per closed loan**, cited as $100–$200 in that 2019 blog. Non-QM and **DSCR investor loans** are reachable through LoanNEX and non-QM lenders on the platform. I found **no evidence of support for commercial real estate loans** (HUD 232/223(f), SBA, CMBS, bridge, agency multifamily).

### Cited Findings
- Pricing: $40 per user per month for the single Broker Edition plan (SpotSaaS); $50 per user per month starting (Capterra / Software Advice); about $55 (ZoftwareHub / SaaSWorthy). FitGap gives a $40–$100 range "reported on vendor blog". — [SpotSaaS](https://www.spotsaas.com/product/lendingpad/pricing); [Software Advice AU](https://www.softwareadvice.com.au/software/77124/lendingpad); [ZoftwareHub](https://zoftwarehub.com/products/lendingpad/pricing); [FitGap](https://us.fitgap.com/products/043242/lendingpad)
- Vendor's own **[older, 2019]** pricing blog: brokers pay $40–$100 per user per month. Lenders pay a "success-linked" $100–$200 per closed loan. — [LendingPad blog: LOS pricing](https://blog.lendingpad.com/loan-origination-system-software-pricing)
- A 2026 third-party review says LendingPad does not publish list pricing, and quotes come from WEI Technology. — [ainora.lt review (snippet only)](https://ainora.lt/blog/lendingpad-ai-review-alternatives-2026)
- Variable add-on costs: DocuSign at $2.50 per envelope. — [KB: DocuSign](https://kb.lendingpad.com/docusign-esign-instructions)
- Target: "cloud-based loan origination software designed to support mortgage brokers, lenders, banks, and credit unions." Gartner lists it under Commercial Loan Origination Solutions, rated on only one review. — [Gartner](https://www.gartner.com/reviews/product/lendingpad)
- Adoption: ZoomInfo estimates 457 companies use it. Capterra shows 4.4/5 from 134 reviews. — [ZoomInfo](https://zoominfo.com/tech/130397/lendingpad-tech-by-revenue); [Capterra](https://www.capterra.com/p/171891/LendingPad/)
- Non-QM / DSCR: the LoanNEX integration gives access to non-QM products and eligibility, including LoanNEX's Broker Marketplace. — [LoanNEX](https://loannex.com/blog/loannex-and-lendingpad-partner-to-create-the-most-comprehensive-access-to-non-qm-products/)
- LendingPad's technology lets lenders offer "conventional loans to customized Non-QM products". Griffin Funding's non-QM division (Everest Funding: bank statement and **DSCR loans for real estate investors**) chose LendingPad as its LOS **[older, October 2022]**. *Note: a search summary misattributed Everest Funding as LendingPad's own division. The release shows it is Griffin Funding's.* — [LendingPad blog: Griffin Funding](https://blog.lendingpad.com/griffin-funding-community-selects-lendingpad-as-los-of-choice)
- Lendz Financial (non-QM wholesale) uses LendingPad as its LOS. — [Lendz](https://lendzfinancial.com/news/lendz-and-lendingpad-further-integration-through-wholesale-channel)

### Inferences
- "Business purpose" support in LendingPad means **1–4 unit residential investor loans** (DSCR) priced through non-QM engines. It is still a residential 1003/MISMO file. It is not commercial real estate. The Gartner "Commercial LOS" category listing rests on one review and looks like a taxonomy artifact, not a product capability.
- At about $40–$55 per user per month, a small Corin team (2–5 staff) would pay roughly $1–3.3k a year. The money is not the obstacle. Fit is.

### Gaps
- No current (2026) vendor price sheet. Implementation and onboarding fees are unknown.
- I found no statement from LendingPad on supporting commercial, multifamily 5+ unit, SBA or HUD loans, either for or against. Absence is inferred from the lack of any mention.

---

## 4. Which LendingPad features are residential-only and not needed for business-purpose commercial loans? And for each capability, is it relevant to Corin, does Corin have or plan it, and what is the gap?

### Takeaway
Roughly half of LendingPad's surface is residential consumer-compliance machinery: TRID LE/CD, HMDA, the NMLS MCR, AUS (DU/LPA), the agency 1003/MISMO, consumer credit tri-merge and comp-to-disclosure sync. None of it applies to Corin's business-purpose commercial loans. What *does* transfer is the workflow scaffolding: milestones, role-scoped pipelines, condition loops, a document vault, e-sign, licensing records and comp tracking. Above all, the **lender-handoff concept**, which Corin must rebuild for a multi-lender, term-sheet-driven commercial process. Most of that is already planned.

### Cited Findings
- TRID / LE-CD disclosures (initial disclosure package by loan type and state) — [KB: Getting Started](https://kb.lendingpad.com/getting-started-in-lendingpad)
- HMDA export, Call Report, NMLS MCR — [KB: FAQs](https://kb.lendingpad.com/faqs)
- AUS DU/DO/LP/LPA — [KB: FAQs](https://kb.lendingpad.com/faqs)
- Fees do not carry from broker to lender file, and comp syncs to the disclosure screen (TRID-linked) — [KB](https://kb.lendingpad.com/lendingpad-brokers-operating-with-lendingpad-wholesale-lenders)
- ComplianceEase (residential predatory-lending, HOEPA and state high-cost testing) **[older, 2019]** — [ComplianceEase](https://blog.lendingpad.com/press-releases/complianceease-announces-integration-with-lendingpad)
- Regulatory background: TRID, HMDA (Reg C) and MLO comp (12 CFR 1026.36(d)) are consumer-mortgage rules on the SAFE MLO exam outline. — [NMLS test outline](https://mortgage.nationwidelicensingsystem.org/knowledge/products/nmls/pubs/testingHbk/education/mlo_testing/mlo_test_faq/mlo_testing_hbk_testOutline.html)

### Inferences

**Relevance and gap matrix.** Legend: Relevance = **High / Med / Low / N/A** (N/A = residential-only). Corin status = **Has** (in production today), **Planned**, or **Missing**. Corin status reflects the context brief only. I did not inspect the Corin repo.

| LendingPad module / feature | Residential-only? | Relevance to Corin | Corin status | What Corin needs to build or integrate |
|---|---|---|---|---|
| Lead capture + CRM, campaigns, lead providers | No | High | **Has** (Twenty CRM sync, qualifier, Jev classification); automation agents **Planned** | Lead-source attribution and referral-partner linkage on opportunities. Twenty workflows for stage SLAs (LendingPad "service level agreements" analogue) |
| POS / borrower application (1003) | 1003 is residential | High (concept); 1003 N/A | 60-second qualifier **Has**; borrower portal **Planned** | A commercial intake form instead of a 1003: sponsor/guarantor PFS, entity docs, property data, T-12, rent roll, STR, PIP budget, capex. Borrower portal with checklist status (avoid LendingPad's reported POS weaknesses: duplicate accounts, login friction) |
| Auto-advancing milestones / statuses | No | High | Pipeline dashboard **Planned** | Define commercial stages (Intake → Sized → Term sheets out → TS accepted → Application/deposit → 3rd-party reports → Commitment → Closing → Funded → Fee collected). Advance them from dates and events, as LendingPad does, so the pipeline is not manually maintained |
| Tasks, due/overdue dashboard | No | High | **Planned** (staff dashboard, closing-checklist agent) | Task model in Supabase or Twenty tasks. Overdue views per deal and per staffer |
| Underwriting conditions (single + batch templates) | No (concept) | High | Document-chasing / closing-checklist agents **Planned** | Per-program condition templates (HUD 232 / 223(f) checklist, SBA 504/7(a) forms, CMBS lender closing checklist, bridge). Lender-issued commitment conditions parsed into tracked items |
| Pricing engine (Optimal Blue, Loansifter, Polly, LoanNEX) | Yes (agency/non-QM rate sheets) | Low as-is; concept High | Loan sizer + fee breakdown **Has**; term-sheet parsing / quote comparison **Planned** | No commercial PPE exists for HUD/CMBS/bridge. Corin's sizer plus parsed lender term sheets is the right substitute. Keep a rate/spread index (Treasury, SOFR, MIP) feed for the sizer |
| Native wholesale network ("Register with Lender" clone) | Residential network | High (concept) | Static lender list routing **Has**; lender matching vs credit boxes **Planned**; partner portal **Planned** | A multi-lender "shop the deal" flow: generate a package or offering memo, send it to N matched lenders, track per-lender status (sent / reviewing / passed / term sheet), and collect term sheets into the comparison. Unlike LendingPad, the broker keeps editing rights. Lenders get versioned package links (Supabase signed URLs) and not a locked clone |
| Direct lender API integrations (UWM, Mutual of Omaha; condition sync) | Residential | Low | Missing (not applicable) | Commercial lenders have no MISMO-style intake APIs. Use email + data room + partner portal. Optional lender-side portal for uploading conditions and term sheets |
| Disclosures: LE/CD, initial package, TRID tolerance | **Yes** | N/A | n/a | Not needed for business-purpose loans. Instead: California DRE broker disclosures where applicable (e.g., the DRE Mortgage Loan Disclosure Statement is generally for consumer loans; confirm with counsel whether any CA commercial broker disclosure applies), a fee agreement or engagement letter, and a non-circumvention agreement |
| ComplianceEase / HOEPA / high-cost testing | **Yes** | N/A | n/a | None |
| HMDA reporting | **Yes** for residential. Multifamily 5+ can be HMDA-reportable for *lenders* (not brokers) | N/A for a broker | n/a | None (Corin is not the lender of record) |
| NMLS MCR, NMLS license auto-update | Yes (NMLS/SAFE). Corin is DRE-licensed | Low | Missing | Light licensing record: DRE license number and expiry for the firm and staff, displayed on the site and in disclosures. Calendar reminder on renewal |
| Credit pulls / AUS (DU, LPA) | **Yes** (consumer tri-merge, agency AUS) | N/A (AUS); Low (credit) | Missing | Commercial lenders pull sponsor credit themselves. At most, record a borrower credit-authorization consent in the consent ledger (**Planned**) |
| VOE/VOI/asset verifications | Yes (residential income docs) | Low | Missing | Not needed. The commercial equivalents are an AI document agent on T-12 / rent roll / STR / bank statements (**Planned**) and sponsor REO schedule extraction |
| Document management / archiving | No | High | Supabase vault with signed uploads **Has** | Doc-type taxonomy per program, versioning, a per-lender share log (who received what package version), and retention rules |
| E-sign (DocuSign, $2.50/envelope) | No | High | DocuSign **Planned** | Templates: engagement / fee agreement, LOI acceptance, borrower authorizations, partner NDAs and referral agreements |
| Roles and permissions (LO/processor see assigned files only; status-based edit locks) | No | High | Staff login **Planned** | Supabase RLS by role (admin, originator, processor, partner, borrower). Assigned-deal scoping. Lock key fields after term-sheet acceptance |
| Branch / virtual branch, licensing enforcement | Mostly multi-branch residential | Low | Missing | Not needed at Corin's size. Virtual-team grouping is enough |
| Broker compensation (lender-paid / borrower-paid, synced to disclosures) | Disclosure sync is residential (LO comp rule) | High (comp tracking itself) | Fee breakdown in sizer **Has**; payout tracking **Missing** | Deal-level fee ledger: origination/placement fee, borrower-paid vs lender-paid (YSP/premium), referral-broker splits, invoice and receipt status, 1099 data for partners |
| Secondary marketing, lock desk, MCT, warehouse, post-closing (Lender Edition) | **Yes** (lender functions) | N/A | n/a | None. Corin is a broker. Track only the rate-lock / rate-cap date in commercial term sheets |
| Reporting / custom reports / dashboards | No | Med–High | Insights **Planned** | Pipeline-by-stage, fee forecast, lender hit rate (term sheets per submission), time-in-stage, source ROI |
| Third-party vendor orders (appraisal, credit; integrated vendor list) | Residential AMC/credit vendors | Med (concept) | Vendor order tracking **Planned** | Track appraisal, Phase I ESA, PCA, market study, CNA (HUD), and hotel PIP/brand reports: ordered, due date, cost, received |
| API (gated, Lender Edition, NDA) + Zapier "Loan Updated" | No | Med | Supabase + Twenty APIs **Has** | Corin already exceeds this. Expose webhooks (deal stage changes) for Twenty automation agents |
| AI (none native; partner AI1 predictive scoring) | n/a | High | Claude advisor + indicative term sheets **Has**; doc agent, package/OM generation, CRM agents **Planned** | Corin is ahead of LendingPad here. Add the AI conversation log (**Planned**) for compliance and audit |
| Audit trail / QC role | No | Med | Consent ledger and AI logs **Planned** | Append-only event log per deal (field changes, document shares, lender submissions, consents) |
| Email / SMS / scheduling | Not documented as LendingPad-native | High | Zoho, Resend, Telnyx, Cal.com **Planned** | Log communications to the deal timeline (Twenty notes/messages) |

**Summary judgments**
- **Residential-only, skip:** TRID LE/CD and tolerance, initial disclosure packages, ComplianceEase/HOEPA, HMDA (as a broker), NMLS MCR, AUS DU/LPA, consumer tri-merge credit and VOE/VOI, MISMO 1003, LO-comp-to-disclosure sync, Lender Edition secondary/lock desk/warehouse/post-closing, and the residential wholesale network and its UWM/Mutual of Omaha APIs.
- **Transferable, already planned by Corin:** milestones and pipeline, tasks, condition and closing checklists, document vault, DocuSign, roles/permissions, reporting, vendor-order tracking, borrower and partner portals.
- **Real gaps, not on Corin's plan list:** (1) a **deal-level fee and commission ledger** (placement fee, lender premium, referral splits, invoices). (2) A **DRE licensing record**, plus a California commercial broker disclosure / fee-agreement template (verify the legal requirements with counsel). (3) A **per-lender submission tracker**, the commercial replacement for "Register with Lender": which package version went to which lender, when, and the outcome. Implied by lender matching, but worth specifying explicitly. (4) **Auto-advancing stage logic** driven by dates and events, with field locks after term-sheet acceptance.
- **Where Corin is already ahead:** AI (advisor, indicative term sheets, planned document extraction and OM generation), open APIs, and a multi-program commercial sizer. LendingPad has no shipped native AI as of 2026 and gates its API.

### Gaps
- Corin status is taken from the brief. I did not check the /home/user/Corin codebase to confirm what is actually live.
- The California DRE disclosure requirements for commercial business-purpose loans were not researched here and need legal review.
- LendingPad's residential-only scope was inferred from the absence of commercial documentation. I found no explicit vendor statement.
