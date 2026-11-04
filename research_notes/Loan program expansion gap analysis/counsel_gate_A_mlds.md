# Counsel Gate A: MLDS (B&P §10240) for Corin Commercial, Inc.

*This is legal research, not legal advice. A California attorney must confirm it.*

**Source note:** leginfo.legislature.ca.gov and law.justia.com would not resolve here, so I could not open any page. **Every citation is a search snippet.** Wording is paraphrased unless quoted. Risk score = severity × likelihood (1–25).

## 1. Bottom line
Corin should give an RE 882 MLDS on every brokered loan secured, directly or collaterally, by any lien on real property. §10240 covers a broker who "negotiates a loan to be secured directly or collaterally by a lien on real property" [S1]. §10240.1 limits the rest of Article 7 to dwellings but excludes §10240 [S2]. §10245's large-loan exemption carves §10240 back in [S3]. The DRE says commercial property and raw land are covered [S4]. The Loan Estimate substitute applies only to federally regulated *residential* loans [S5]. Highest risk: table funding in Corin's name, which §10234 generally bars [S6].

## 2. Decision table
| Loan type | MLDS? | Form | Authority | Confidence |
|---|---|---|---|---|
| HUD, agency, CMBS, bank, life company, bridge, construction, multifamily/mixed-use | Yes | RE 882 | S1–S4 | High |
| Any size ($750k–$50M) | Yes; no ceiling found | RE 882 | S3 | High |
| §10133.1 institutional lender | Yes; §10133.1 exempts lenders from licensing, not the broker's MLDS | RE 882 | S1, S7 | Medium |
| Lender gives its own HUD/SBA disclosures | Yes; only substitute is §10240(c), residential only | RE 882 | S5 | Medium |
| SBA 504, or 7(a) with any real-estate lien | Yes | RE 882 | S1 | High |
| SBA 7(a), non-real-estate collateral only | No, but see open question 3 | n/a | S1, S8 | Medium |
| Table-funded, Corin named | Yes, and **blocked** pending §10234 review | RE 882 | S1, S6 | Medium |
| Referral only; lender negotiates | Unresolved; treat as Yes if Corin is paid | RE 882 | S1, S8 | Low |
| Nontraditional loan, 1–4 residential units | Yes | RE 885 | S9 | High |
| RE 883 | Avoid: legacy MLDS/GFE form | none | S9 | Medium |

## 3. Platform requirements
**Trigger.** Generate the MLDS when `collateral_includes_real_property = true` AND `corin_role = broker`.

**Timer.** The clock starts on the timestamp Corin receives a *completed written loan application*. The MLDS is due by the earlier of 3 business days or before the borrower "becomes obligated on the note" [S1, S4]. Warn on day 2.

**Fields (§10241 / RE 882).**
- Estimated maximum borrower-paid costs: appraisal, escrow, title, notary, recording [S11]
- All broker compensation, including lender-paid splits [S12]
- Loan terms and payments
- Credit insurance not required (§10241.1, 2007 text) [S13]
- Broker-controlled funds "will not" be used (§10241(j), §10241.2) [S13]
- Corin's name, license number and licensed address [S11]
- A notice that figures are estimates [S11]

**Signatures.** Each borrower signs. Corin signs through its broker or a licensee acting for the broker [S1]. The borrower gets an exact copy. Zoho Sign is acceptable: the DRE says e-signed MLDSs are enforceable [S14]. Capture UETA consent.

**Retention.** Keep the signed MLDS for 3 years [S1, S15]. Electronic storage is allowed if records can be viewed at the office and printed for the DRE on request (10 CCR §2729) [S15].

**Hard blocks.**
- No commitment or loan document goes to the borrower for signature before the MLDS is signed.
- No deal moves to "closing" without a signed MLDS on file.
- Deals naming Corin as beneficiary or originator are held for counsel.
- No loan ad is published without the license statement.

**Advertising (Q5).**
- Show the license number in loan ads (§10235.5, §10236.4) [S16].
- 10 CCR §2847.3 statement: "Real estate broker, California Department of Real Estate" (Justia's copy reads "Bureau"), in type at least as large as the smallest type in the ad [S17].
- First-point-of-contact materials need the 8-digit license number and responsible broker name (§10140.6, 10 CCR §2773) [S16].
- No misleading rates or terms (§10235, 10 CCR §2848) [S18].

**Consequences (Q4).** The DRE disciplines MLDS violations under §10177(d)/(g), from restricted licenses up to revocation [S10, S12]. §10246's treble recovery is tied to Article 7's charge limits, which mostly do not reach these loans [S2, S19]. I found no MLDS-specific private right of action.

## 4. Open questions for counsel (ranked by risk)
1. **Table funding in Corin's name.** Does the §10234(d) exception apply to any deal? Usury (Civ. Code §1916.1)? Score 16, RED [S6].
2. **Referral-only.** §10240 says "negotiates" while §10131(d) says "solicits." Does a paid referral trigger the MLDS? Score 12 [S8].
3. **SBA 7(a) on business assets only.** §10131(d) reaches liens "on a business." Is a CFL broker license needed? Score 12 [S8, S20].
4. **Lender-side exemption.** Does the "institutional or table-funded" exemption alluded to in the DRE manual exist? None was found. Score 9.
5. **Definitions.** What is a "completed application," and when does a borrower become "obligated"? Should the MLDS be re-issued when terms change? Score 9.
6. **Out-of-state collateral and e-sign conditions.** Score 4–6.

## 5. Confidence
- MLDS required on commercial real-estate-secured loans: **High**
- RE 882 is the right form: **Medium-high**
- No institutional or lender-disclosure exemption: **Medium**
- Table-funding prohibition: **Medium**
- Referral-only position: **Low**
- E-signatures allowed: **Medium-high**

## Sources (snippets)
- S1 [§10240](https://california.public.law/codes/business_and_professions_code_section_10240)
- S2 [§10240.1](https://law.counselstack.com/statute/ca/BPC/10240.1.)
- S3 [§10245](https://codes.findlaw.com/ca/business-and-professions-code/bpc-sect-10245/)
- S4 [DRE advisory](https://www.dre.ca.gov/files/pdf/adv/2015_2019/Advisory2015MLDS%20and%20Loan%20Estimate%20Advisory.pdf)
- S5 [§10240(c)](https://codes.findlaw.com/ca/business-and-professions-code/bpc-sect-10240/)
- S6 [§10234](https://law.justia.com/codes/california/code-bpc/division-4/part-1/chapter-3/article-5/section-10234/); [RE 7](https://dre.ca.gov/files/pdf/re7.pdf)
- S7 [§10133.1](https://codes.findlaw.com/ca/business-and-professions-code/bpc-sect-10133-1/)
- S8 [§10131](https://law.justia.com/codes/california/code-bpc/division-4/part-1/chapter-3/article-1/section-10131/)
- S9 [DRE forms](https://dre.ca.gov/forms/MLB.html)
- S10 [H02799SD](https://www2.dre.ca.gov/hearingfiles/H02799SD_P.pdf); [H03080FR](https://www2.dre.ca.gov/hearingfiles/H03080FR_170320_P.pdf)
- S11 [§10241](https://california.public.law/codes/business_and_professions_code_section_10241); [RE 882](https://www.dre.ca.gov/files/pdf/forms/re882.pdf)
- S12 [Avakian](https://journal.firsttuesday.us/?p=89304)
- S13 [2007 Art. 7](https://law.justia.com/codes/california/2007/bpc/10240-10248.3.html); [§10241.2](https://codes.findlaw.com/ca/business-and-professions-code/bpc-sect-10241-2/)
- S14 [DRE Bulletin 2021](https://www.dre.ca.gov/files/pdf/reb/rebsum_21.pdf)
- S15 [§10148](https://california.public.law/codes/business_and_professions_code_section_10148); [§2729](https://www.law.cornell.edu/regulations/california/10-CCR-2729)
- S16 [RE 858](https://www.dre.ca.gov/files/pdf/forms/re858.pdf); [§2773](https://law.cornell.edu/regulations/california/10-CCR-2773)
- S17 [§2847.3](https://regulations.justia.com/states/california/title-10/chapter-6/article-16/section-2847-3)
- S18 [§2848](https://law.cornell.edu/regulations/california/10-CCR-2848)
- S19 [§10246](https://california.public.law/codes/business_and_professions_code_section_10246)
- S20 [Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2024/01/california-moving-to-license-all-commercial-loan-brokers)
