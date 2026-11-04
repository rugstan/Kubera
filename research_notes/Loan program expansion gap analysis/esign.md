# E-Signature Providers, Legal Suitability, and Notarization/RON for Corin Commercial (as of Oct 2026)

Research note, not legal advice. Method: none of the vendor pages could be fetched from this environment (zoho.com, boldsign.com, signwell.com and help.dropbox.com all failed DNS resolution in the sandbox). **Every figure below comes from a web-search result snippet or a search-engine summary of the linked page** unless marked otherwise. Many of the pricing sources are competitor or affiliate blogs, and they often disagree. Confirm each price on the vendor's live pricing page before committing. Monthly cost figures at 50/200/1,000 envelopes are my own arithmetic on the cited unit prices and are labeled "computed".

## Q1. Vendor comparison: API availability, price at 50 / 200 / 1,000 envelopes per month, features, suitability

### Takeaway
On published API prices, the cheapest credible options are DocuSeal (about $0.20 per API document plus a seat fee), Zoho Sign (about $0.50 per API envelope in credits, no subscription) and BoldSign ($30/month including 40 envelopes, then $0.75 each). SignWell is close behind (25 free, then $0.85 falling to about $0.20). DocuSign, Dropbox Sign, PandaDoc and Adobe cost far more per envelope at 200 or more per month, or hide production API pricing behind sales quotes.

### Cited Findings

**Pricing (sourced unit prices)**
- **BoldSign (Syncfusion):** each API envelope is one signature request billed at $0.75. Reminders, extending expiry, editing, listing, revoking, deleting and downloading are free. — [BoldSign KB: API signature request charges](https://support.boldsign.com/kb/article/21759/understanding-signature-request-charges-in-boldsign-api)
- BoldSign's API plan "starts from $30/month, includes 40 envelopes", then pay-as-you-go at $0.75 per envelope. High-volume customers can request a custom quote. A free sandbox is available (third-party summaries say its documents are watermarked and deleted after 14 days). — [BoldSign pricing](https://boldsign.com/pricing) (search snippet); [BoldSign API FAQs](https://support.boldsign.com/kb/article/17948/boldsign-api-faqs)
- One third-party page claims BoldSign API usage falls to $0.01 per envelope beyond quotas. This contradicts BoldSign's own documentation and should be disregarded. — [esign.ai](https://www.esign.ai/blog/boldsign-api-pricing-structure-details)
- **Zoho Sign:** the official pricing page says the API-only plan has no subscription fee and runs on purchased Zoho Sign credits. Envelopes sent via API or third-party apps always consume credits, whatever the subscription plan. — [Zoho Sign pricing](https://www.zoho.com/sign/pricing.html) (search snippet)
- Third-party sources put a standard Zoho Sign API envelope at 5 credits, or about $0.50, with SMS, authentication and trust-service charges extra. — [verdocs Zoho Sign pricing guide](https://verdocs.com/?p=13942); [Certinal](https://www.certinal.com/blog/zoho-sign-pricing)
- Zoho Sign UI plans: sources conflict on the starting price ($10 vs $12 per user/month for Standard). One source lists a free tier of 5 envelopes/month. — [Capterra Zoho Sign pricing](https://www.capterra.com/p/215876/Zoho-Sign/pricing/); [Signeasy](https://signeasy.com/blog/business/zoho-sign-pricing)
- **Zoho bundles:** Enterprise-plan organizations, including bundles like Zoho One, receive complimentary Zoho Sign credits each billing cycle: 50 credits per licensed Sign user, capped at 2,500 per month. — [Zoho help: Zoho Sign credits](https://help.zoho.com/portal/en/kb/zoho-sign/faqs/general-faqs/articles/zoho-sign-credits-21-6-2023)
- The same help content says "the Zoho Sign API and advanced third-party integrations require the purchase of Zoho Sign credits as add-ons". Credits are consumed when a document is sent via API, not when it is uploaded. Bulk send costs 5 credits per document. Purchased credits do not expire. — [Zoho help: credits add-on](https://help.zoho.com/portal/en/kb/zoho-sign/admin-guide/document-timestamping/articles/zoho-sign-credits-add-on)
- An older Zoho community post describes "automation credits" (10 per user, capped at 500 per month, not usable for third-party automation). It is unclear whether this model is still current. — [Zoho community](https://help.zoho.com/portal/en/community/topic/introducing-automation-credits-in-zoho-sign)
- **SignWell:** the first 25 API documents per month are free with a credit card on file. After that, pricing starts at $0.85 per document and falls with volume to $0.20 or lower on high-volume or custom plans. A document can hold multiple files, signers and steps and is billed once. Third parties cite $0.75 or about $0.70, which conflicts with the official page. — [SignWell API pricing](https://www.signwell.com/api-pricing/) (search snippet); [SignWell help: API requests](https://help.signwell.com/article/251-api-and-zapier-requests)
- **Dropbox Sign API:** non-embedded requesting falls under the Essentials API plan. Embedded signing and embedded requesting require Standard API. test_mode allows free testing. — [Dropbox help: API cost](https://help.dropbox.com/plans/how-much-does-the-dropbox-sign-api-cost) (search snippet)
- Dropbox Sign prices from third parties: Essentials API is about $75/month billed annually for 50 requests/month. Standard API is reported at $250/month for 100 requests, or alternatively $300/month ($3,600/year). Premium is custom. — [Signeasy](https://signeasy.com/blog/business/dropbox-sign-pricing); [verdocs](https://verdocs.com/?p=13952)
- **DocuSign (baseline):** DocuSign's developer plan page lists $50 (Starter), $300 (Intermediate) and $480 (Advanced) per month, with Enterprise at custom pricing. Third parties report envelope caps of about 40/month (Starter) and about 100/month (Intermediate and Advanced). Bulk send and PowerForms are reported as Advanced-tier features. — [DocuSign developer plans](https://ecom.docusign.com/plans-and-pricing/developer); [firma.dev](https://firma.dev/insights/docusign-api-pricing-limitations-alternatives); [Signeasy DocuSign API pricing](https://signeasy.com/blog/business/docusign-api-pricing)
- **PandaDoc API:** the first 60 documents are free, then a Developer plan at $40/month includes 40 documents. Third-party sources put overage at $4 or $5 per document. Production API access is reported as Enterprise-only (custom pricing). — [PandaDoc API pricing](https://www.pandadoc.com/developer-api/pricing/); [SignWell PandaDoc API review](https://www.signwell.com/resources/pandadoc-api-review/)
- **SignNow (airSlate):** third-party sources conflict. One reports an API plan at $146/month (annual) including 1,000 signature invites. Others say full API access requires the Site License at about $1.50 to $1.75 per invite, by quote. — [SignNow API pricing page](https://www.signnow.com/features/digital-signature-api-pricing); [Signeasy](https://signeasy.com/esign-api-guide/signnow-esign-api); [docupilot](https://www.docupilot.com/blog/signnow-pricing)
- **Adobe Acrobat Sign:** no public production API price and no published overage price. User plans include 150 transactions per user per year. Third-party estimates range widely (about $1,200/year for 50 envelopes/month; about $0.50 to $1.00 per overage envelope). — [verdocs Adobe Sign pricing](https://verdocs.com/blog/adobe-sign-pricing); [pearsign](https://pearsign.com/blog/adobe-acrobat-sign-transaction-limits)
- **DocuSeal:** DocuSeal's own on-premises page lists Pro at $240/year per user plus $0.20 per document signed via API or embedding, and lists SOC 2 among the Pro features. — [DocuSeal on-premises](https://www.docuseal.com/on-premises) (search snippet)
- DocuSeal cloud is reported at $20/user/month or $200/user/year, with a free tier of 10 signatures/month. Sources conflict on whether the self-hosted Pro license is $240 flat for unlimited users or per seat. — [verdocs DocuSeal pricing guide](https://verdocs.com/blog/docuseal-pricing-guide); [opsily](https://opsily.com/docuseal-hosting/docuseal-pro-self-hosted-license-cost); [sliplane](https://sliplane.io/blog/5-open-source-docusign-alternatives)
- **Documenso:** managed plans reported from about $25 to $30/month. No sourced API per-document price was found. — [sliplane](https://sliplane.io/blog/5-open-source-docusign-alternatives); [ossalt](https://ossalt.com/guides/documenso-vs-opensign-2026)
- **OpenSign:** one comparison lists a starting price of $9.99/month, with no detailed plan breakdown. — [verdocs OpenSign alternatives](https://verdocs.com/blog/opensign-alternatives)

**Computed monthly cost (my arithmetic on the cited unit prices; excludes SMS/ID-verification add-ons and taxes)**

| Provider | Price basis (cited) | ~50/mo | ~200/mo | ~1,000/mo | Notes |
|---|---|---|---|---|---|
| DocuSeal (cloud/Pro) | $0.20/API doc + ~$20/user/mo or $240/yr | ~$30 | ~$60 | ~$220 | 1 seat assumed; vendor maturity and SOC 2 report should be verified |
| Zoho Sign (API credits) | ~$0.50/envelope (5 credits), no subscription | ~$25 | ~$100 | ~$500 | SMS/KBA consume extra credits; price per credit not confirmed on official page |
| BoldSign API | $30/mo incl. 40, then $0.75 | $37.50 | $150 | $750 (custom quote likely lower) | Most transparent official pricing |
| SignWell API | 25 free, then from $0.85 tapering to ~$0.20 | ≤ $21.25 | ≤ $148.75 | ≤ $829 (likely lower; tier breakpoints unknown) | Upper bounds at $0.85 |
| Dropbox Sign API | Essentials ~$75 (50 req); Standard $250–300 (100 req) | $75 (non-embedded) / $250–300 (embedded) | Higher tier or overage, price unknown | Premium (custom) | Embedded signing needs Standard |
| PandaDoc API | $40 incl. 40, overage $4–5 | ~$80–90 | ~$680–840 | ~$3,880–4,840 | Production may require Enterprise |
| SignNow | $146/mo incl. 1,000 invites (disputed) or ~$1.50–1.75/invite | $146 or ~$75–88 | $146 or ~$300–350 | $146 or ~$1,500–1,750 | Sources conflict; get a quote |
| Adobe Acrobat Sign | Not public | quote | quote | quote | Enterprise sales motion |
| DocuSign API | $50 (~40 env), $300 / $480 (~100 env) | $300 (Starter cap exceeded) | Enterprise (custom) | Enterprise (custom) | Baseline; most expensive per envelope |

**Feature matrix (what the sources support; "unverified" = from prior knowledge, not confirmed this session)**

| Provider | Embedded signing / API | Webhooks | Prefilled templates | Signer auth | Bulk send | Routing | In-person | White-label | SOC 2 / ISO 27001 |
|---|---|---|---|---|---|---|---|---|---|
| BoldSign | Yes (API plan) | Unverified (yes) | Yes (template sends billed same) [KB](https://support.boldsign.com/kb/article/21759/understanding-signature-request-charges-in-boldsign-api) | Email/SMS OTP, ID verification add-on: unverified | Unverified (yes) | Unverified (seq/parallel) | Unverified | Unverified (yes) | Unverified (SOC 2 Type II, HIPAA, ISO 27001 claimed) |
| Zoho Sign | API-only credit plan [Zoho](https://www.zoho.com/sign/pricing.html) | Unverified (yes) | Unverified | SMS/authentication billed extra [verdocs](https://verdocs.com/?p=13942); KBA unverified | Yes, 5 credits/doc [Zoho help](https://help.zoho.com/portal/en/kb/zoho-sign/admin-guide/document-timestamping/articles/zoho-sign-credits-add-on) | Unverified | Unverified | Unverified | Unverified (Zoho claims SOC 2/ISO 27001) |
| SignWell | Yes; multi-signer docs billed once [SignWell](https://www.signwell.com/api-pricing/) | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified |
| Dropbox Sign | Embedded on Standard API only [Dropbox](https://help.dropbox.com/plans/how-much-does-the-dropbox-sign-api-cost) | Unverified (yes) | Templates; Standard web plan adds more [Signeasy](https://signeasy.com/blog/business/dropbox-sign-pricing) | Unverified | Unverified | Unverified | Unverified | Branding on Standard [Signeasy](https://signeasy.com/blog/business/dropbox-sign-pricing) | Unverified |
| DocuSign | Yes | Yes (Connect): unverified | Yes | SMS/KBA/IDV add-ons: unverified | Advanced tier [firma.dev](https://firma.dev/insights/docusign-api-pricing-limitations-alternatives) | Yes | Yes | Yes | Unverified (SOC 2, ISO 27001) |
| DocuSeal | Yes, $0.20/doc API/embed [DocuSeal](https://www.docuseal.com/on-premises) | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | SOC 2 listed on Pro [DocuSeal](https://www.docuseal.com/on-premises); Type II claim by a competitor [Zoho](https://www.zoho.com/sign/alternatives/docuseal-vs-zoho-sign.html) |
| Documenso | Embedded React component [ossalt](https://ossalt.com/guides/documenso-vs-opensign-2026) | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | Not found |
| OpenSign | Unverified | Unverified | Unverified | Unverified | Yes, out of the box [ossalt](https://ossalt.com/guides/documenso-vs-opensign-2026) | Unverified | Unverified | Unverified | Not found |

### Inferences
- **Recommendation: BoldSign** as the primary API provider. It has the clearest official per-envelope pricing ($37.50/month at 50 envelopes, $150 at 200), a developer-oriented API with free sandbox, template sends at the same price, and free reminders and downloads. Combined with Corin's Inngest workflows, it should support webhook write-back to Supabase deal records and the audit log. Its ID verification, webhook and SOC 2 Type II claims came from prior knowledge and must be confirmed on boldsign.com before signing.
- **Runner-up: Zoho Sign (API-only credits).** It is cheaper ($25 at 50, $100 at 200) with no subscription, and the vendor is already in Corin's stack. However, Corin uses Zoho Mail/Workplace, not Zoho One Enterprise, so the complimentary credit pool likely does not apply, and the help text says API sends need purchased credits anyway. Bundling therefore gives little practical saving on the API path. The credit model (extra credits for SMS OTP and authentication) makes costs less predictable.
- **Budget option: DocuSeal cloud or Pro.** At about $60 for 200 documents/month it is the lowest sourced cost, but it is a smaller vendor. Get its SOC 2 report and check audit-trail quality before using it for loan documents.
- DocuSign at 200 or more envelopes/month needs an Enterprise quote. Every alternative above costs well under the $300 to $480/month DocuSign tiers at Corin's expected volume.
- Dropbox Sign's $250 to $300/month gate for embedded signing and PandaDoc's $4 to $5 overage make both poor value at 200 envelopes/month.
- None of the providers looks legally unsuitable for broker engagement, fee, NDA or referral documents. The deciding factors are API ergonomics, cost and identity-assurance options (needed for SBA, see Q2).

### Gaps
- No official confirmation (pages unreachable) of: BoldSign's webhook list, SMS/ID-verification add-on prices, SOC 2/ISO status and data residency; Zoho Sign's USD price per credit and SMS/KBA credit cost; SignWell's volume tier breakpoints; Dropbox Sign's API overage price; Documenso's API pricing and SOC 2; OpenSign's compliance status.
- KBA availability (as opposed to ID document verification) per vendor was not verified for any provider.
- No 2026 G2/Capterra head-to-head was retrieved with usable detail.

## Q2. Legal validity (ESIGN / California UETA) and where wet ink or notarization is still needed

### Takeaway
Under California UETA (Civ. Code §1633.1 et seq.) and federal ESIGN, e-signatures are generally valid for Corin's broker agreements, NDAs, fee-splits and authorizations. SBA accepts e-signatures across 7(a) and 504 documents subject to identity-assurance standards, now set out in SOP 50 10 8 Appendix 10 (reported effective June 1, 2025). Recordable instruments (deeds of trust, assignments, reconveyances) still require notarization for recording. Recorders can accept electronic recording, but in-state California RON is not yet operative.

### Cited Findings
- California UETA statute text (Civ. Code Title 2.5, §1633.1 et seq.). — [leginfo UETA](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=CIV&division=3.&title=2.5.&part=2.&chapter=&article=)
- §1633.3(b) excludes transactions governed by laws on wills, codicils and testamentary trusts, but expressly does not prohibit electronic recording with a county recorder. — [Justia §1633.3](https://law.justia.com/codes/california/2011/civ/division-3/1633.1-1633.17/1633.3/) (2011 version; check the current text)
- §1633.11(a): an electronic signature satisfies a notarization or acknowledgment requirement if the notary's electronic signature and all other required information are attached to or logically associated with the record. — [Justia §1633.11](https://law.justia.com/codes/california/code-civ/division-3/part-2/title-2-5/section-1633-11/)
- **SBA:** Procedural Notice 5000-1323, "Acceptance of Electronic Signatures in the 7(a) and 504 Loan Program", allows e-signatures on documents from application through liquidation. It excludes voice/audio-only signatures and requires lender e-signature technology to follow NIST SP 800-63-2 and OMB M-04-04, with the signature attached to or logically associated with the document. — [SBA PN 5000-1323](https://www.sba.gov/document/procedural-notice-5000-1323-acceptance-electronic-signatures-7a-504-loan-program); [SBA PN 5000-20009 (NADCO copy)](https://cdn.ymaws.com/www.nadco.org/resource/resmgr/technical_issues_memo/ti_2/ti_3/SBA_Proc_Notice_5000-20009.E.pdf)
- SOP 50 10 8 added Appendix 10 on Electronic Signatures, reported effective June 1, 2025 (secondary sources). — [AmPac](https://ampac.com/sba-sop-50-10-8-updates/); [sbalenders.com](https://www.sbalenders.com/sba-sop-50-10-8-key-changes-from-sop-50-10-7/)
- E-signatures on SBA Form 413 are reported as accepted when they meet Identity Assurance Level 2 and ESIGN, though some lenders still require wet ink at closing (blog). — [statementsready](https://statementsready.com/blog/personal-financial-statement-signature-and-dating-rules)
- SBA Form 159 must be signed by the applicant, the agent (a separate form per agent) and the lender. It is submitted to SBA after initial disbursement, and itemization is required when an agent's compensation exceeds $2,500 (blog). An unconfirmed claim cites "SOP 50 10 8.1" with a 90-day dating rule for loans submitted from Oct 1, 2026. — [statementsready Form 159](https://statementsready.com/blog/sba-form-159-fee-disclosure)
- The 2020 COVID allowance for scanned documents has expired. — [Ward and Smith](https://www.wardandsmith.com/articles/sba-allows-scanned-copies-of-documents-during-covid-19-crisis)
- **Recording:** a secondary source says the recorder requires notarization before accepting a deed (cites Gov. Code §27287). — [business-attorney.com](https://www.business-attorney.com/what-you-need-to-know-about-electronic-signatures-for-california-transactions/)
- Out-of-state acknowledgments, including RON, are recognized under Civ. Code §1189(b) if they comply with the law where they were taken. LA County Recorder policy (May 2020) relies on this. — [LA County Recorder notary acceptance policy](https://www.lavote.gov/docs/rrcc/documents/05042020_Recorder_Notary-Public-Acceptance-Policy.pdf); [Proof: CA real estate](https://www.proof.com/blog/california-real-estate)
- Conflicting views: vendors say almost all recorders accept out-of-state RON deeds, especially counties that e-record. Others say recorders typically reject out-of-state-notarized deeds of trust and grant deeds. — [NotaryCam](https://www.notarycam.com/remote-notary-california/); [916notary](https://www.916notary.com/remote-online-notarization-california); [ctccal](https://ctccal.com/blog/understanding-remote-online-notarization-for-los-angeles-real-estate-transactions)
- AB 2004 (effective Jan 1, 2025) reportedly allows a certified tangible copy of an electronic record to be submitted for recording, a fallback for counties that don't e-record. — [Proof: CA real estate](https://www.proof.com/blog/california-real-estate) (search summary)
- A COVID-era California Lawyers Association letter flags uncertainty over e-signing trust instruments. — [CLA letter](https://calawyers.org/trusts-and-estates/letter-regarding-covid-19-remote-online-notarization-by-california-notaries/)

### Inferences
- **E-sign is fine for:** borrower engagement and fee agreements, referral fee-split and non-circumvention agreements, NDAs, vendor engagements and credit/background authorizations. These are ordinary commercial contracts not excluded by §1633.3. Background and credit authorizations may carry FCRA disclosure formatting requirements; counsel should confirm.
- **SBA forms (159, 1919, 413, 4506-C):** e-sign is acceptable in principle, but the platform must deliver IAL2-level identity proofing. In practice that means ID-document verification or KBA, not just an email link. The SBA lender's own policy controls, and some lenders still want wet ink. Choose a vendor with an ID verification add-on and confirm the Appendix 10 text.
- **Hard money loan documents, if Corin funds loans:** the promissory note, loan agreement and guaranties can be e-signed. The deed of trust, assignment of deed of trust, reconveyance and any recorded affidavit or memorandum need a notarial acknowledgment. Today that means an in-person California notary, a California notary performing an in-person electronic notarization, or out-of-state RON relied on under §1189(b). Recording then goes via the title company's e-recording (ERDA) or paper. Note-transfer and endorsement mechanics for a negotiable note may favor wet ink unless an eNote registry is used; counsel should confirm.
- HUD forms are not relevant to commercial CRE lending except HUD/FHA multifamily (e.g., 223(f)), which follows its own closing-document e-sign rules. Not researched; see Gaps.

### Gaps
- Primary text of SOP 50 10 8 Appendix 10 and of SBA Form 159/1919 signature instructions was not retrieved. The NIST 800-63-2 reference comes from older notices and may have been updated to 800-63-3/-4.
- No source was found on HUD's e-signature policy for multifamily/commercial programs.
- No source was found on the ERDA statute (Gov. Code §27390 et seq.) or a current list of e-recording counties.
- The federal ESIGN Act (15 U.S.C. §7001) was not separately sourced this session.

## Q3. Remote online notarization (RON) status in California and provider pricing

### Takeaway
SB 696 (the Online Notarization Act) took effect January 1, 2024, but its RON provisions only become operative once the Secretary of State completes a technology project, or January 1, 2030, whichever is earlier. As of September 2026, California notaries still cannot perform RON. Out-of-state RON notaries (around $25 per notarization) are the current workaround, subject to county and title acceptance.

### Cited Findings
- California notaries may not provide online notarization until registration and the SOS technology project are complete, with a deadline of January 1, 2030. — [CA SOS Notary Handbook](https://notary.cdn.sos.ca.gov/forms/notary-handbook-current.pdf); [California Notary Association: SB 696](https://www.calnotaries.org/law-alerts/the-golden-state-goes-digital-sb-696-now-law/clin-staff)
- A guide citing SOS notary FAQs (accessed Sept 19, 2026) says California notaries cannot currently perform RON, and the online notary registration program is not accepting applications in 2026. — [californianotaryprep](https://www.californianotaryprep.com/remote-online-notarization-california-2026/); [remotenotarez (Aug 2026)](https://remotenotarez.com/blog/2026/08/21/is-online-notarization-legal-in-california-what-residents-need-to-know/)
- Sources give different signing dates for SB 696 (Sept 23 vs Sept 30, 2023). — [SB 696 summary site](https://californiaonlinenotarization.com/sb696.html)
- Old Republic Title says out-of-state notaries can perform RON for California residents and California real estate documents now. — [Old Republic Title CA RON flyer (Jan 2024)](https://www.oldrepublictitle.com/media/mueitkjq/or5108-california-remote-online-notarization-di-flyer-ca-010224.pdf)
- **Proof (Notarize):** reported at $25 per notarization on its network plus $10 per additional seal. Business pricing is not disclosed. — [thedigitalmerchant](https://thedigitalmerchant.com/?p=71366); [PricingSaaS Proof](https://pricingsaas.com/companies/proof)
- **OneNotary:** $25 per notarization (1 stamp, 1 signer), plus $10 per additional stamp. No bulk or business membership. — [TrustRadius](https://www.trustradius.com/compare-products/docverify-vs-onenotary); [OneNotary](https://onenotary.com/?p=4036)
- **DocVerify:** priced per user, reported at $24/user/month (Business E-Sign) and $65 (Enterprise E-Sign), with custom Enterprise Group. — [verdocs DocVerify pricing](https://www.verdocs.com/blog/docverify-pricing)
- RON typically costs $15 to $50 per session, most around $25 (June 2026 fee guide). — [statenotaryfee](https://statenotaryfee.pages.dev/online-notary-cost)

### Inferences
- For any recordable instrument, coordinate with the title company (most CA title insurers operate e-recording and maintain lists of approved RON platforms). Proof is the most title-integrated option. Budget about $25 to $35 per signer session.
- RON is not needed for Corin's core broker workflow (engagement, fee, NDA, referral, SBA authorizations). It only matters if Corin originates or funds hard money loans with recorded security instruments.

### Gaps
- Official SOS RON FAQ and the current registration timeline were not fetched directly.
- No county-by-county acceptance list for out-of-state RON was found. Proof's enterprise or title pricing is not public.

## Q4. Self-hosting Documenso / DocuSeal / OpenSign on Corin's stack (Next.js on Vercel, Supabase)

### Takeaway
Self-hosting saves at most about $50 to $150/month at Corin's volume. In exchange, Corin would own uptime, signing-certificate management, email deliverability, backups and the evidentiary defensibility of the audit trail. Only Documenso (Postgres) is a natural fit for Supabase. DocuSeal (Rails) and OpenSign (MongoDB) need separate hosting. For loan documents, a vendor-hosted, SOC 2-audited service is the more defensible choice.

### Cited Findings
- Documenso requires PostgreSQL and its self-host setup is more involved. OpenSign uses MongoDB. DocuSeal supports SQLite, PostgreSQL and MySQL, with roughly 1 to 2 hours to the first document via Docker (vs 2 to 4 hours for OpenSign). — [sliplane](https://sliplane.io/blog/5-open-source-docusign-alternatives); [signb.ee DocuSeal vs OpenSign](https://signb.ee/blog/opensign-vs-docuseal-vs-signbee)
- Self-hosted hosting cost estimate: under $500/year (a $10 to $20/month VPS plus S3 storage). — [sliplane](https://sliplane.io/blog/5-open-source-docusign-alternatives)
- Licensing: sources list AGPL-3.0 for all three; one says DocuSeal is MIT (conflicting). — [sliplane](https://sliplane.io/blog/5-open-source-docusign-alternatives); [ossalt](https://ossalt.com/guides/documenso-vs-opensign-2026)
- Documenso leads on developer experience and its embedded-signing React component. OpenSign has more out-of-the-box features (bulk send, field types). DocuSeal is rated the most mature. — [ossalt](https://ossalt.com/guides/documenso-vs-opensign-2026); [osalfinder](https://osalfinder.com/blog/docusign-vs-docuseal-esignature-comparison/)
- DocuSeal Pro (self-hosted) adds paid features including SOC 2 and charges $0.20 per API/embedded document. — [DocuSeal on-premises](https://www.docuseal.com/on-premises)

### Inferences
- **Operational burden:** whoever self-hosts must manage a document-signing (PKCS#12) certificate, ideally from an AATL-trusted CA so PDFs show as validly signed in Acrobat. They must also run background job workers and SMTP (Resend would work), keep Supabase storage backups and retention immutable, and patch promptly. My understanding is that Documenso is a Next.js/Prisma monorepo, but long-running signing and seal jobs fit Vercel serverless poorly; a container host (Fly, Render, Railway) is the usual choice. This architecture point is unverified.
- **Compliance:** a self-hosted instance inherits none of the vendor's SOC 2 coverage. Corin's own controls would be what a court, SBA lender or investor examines. Audit-trail quality (IP address, timestamps, email/OTP evidence, tamper-evident hash) depends on the open-source version and configuration. A lightly maintained self-host makes authentication-of-signature disputes harder to win.
- **AGPL:** modifying and exposing an AGPL app over a network creates source-disclosure obligations. Counsel should review this if Corin customizes the code.
- **Conclusion:** at 50 to 200 envelopes/month, DocuSeal or Documenso cloud (vendor-hosted) or BoldSign is a better trade-off than self-hosting. Revisit self-hosting only at several thousand envelopes/month.

### Gaps
- No primary-source audit of each open-source project's certificate-of-completion contents was retrieved.
- Documenso's SOC 2 status and cloud API pricing were not found.
- No source confirmed whether Documenso runs on Vercel.
