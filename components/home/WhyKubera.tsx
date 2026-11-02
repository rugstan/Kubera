import Link from "next/link";
import { formatUsd } from "@/content/deal-structures";
import { HOME_REASONS } from "@/content/home";
import { publishableRecords } from "@/content/track-record";
import { dreLookupUrl, site } from "@/lib/site";
import { Reveal } from "./Reveal";

/** The homepage's one black section: why a broker, plus verified closings once there are any. */
export function WhyKubera() {
  const license = site.dreCorporateLicense;
  const records = publishableRecords().slice(0, 3);
  return (
    <section aria-labelledby="why-kubera-title" className="bg-pro py-20 text-white md:py-32">
      <div className="mx-auto max-w-[1280px] px-5 md:px-8">
        <Reveal className="mx-auto max-w-[980px] text-center">
          <p className="eyebrow">Why a broker</p>
          <h2 id="why-kubera-title" className="mt-3 text-headline font-semibold md:text-section">
            We work for you, not for one lender.
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-[17px] text-titanium md:text-lede">
            A bank can only offer its own loans. We compare the programs and lenders that fit your property, then help you negotiate the terms.
          </p>
        </Reveal>
        <ul className="mx-auto mt-12 grid max-w-[1080px] gap-5 md:mt-16 md:grid-cols-2">
          {HOME_REASONS.map((r, i) => (
            <li key={r.title}>
              <Reveal delay={i * 0.05} className="h-full">
                <div className="bento-pro flex h-full flex-col rounded-tile-lg p-7 md:p-10">
                  <h3 className="text-[21px] font-semibold leading-snug md:text-subhead">{r.title}</h3>
                  <p className="mt-3 text-[17px] text-titanium">{r.body}</p>
                  {r.verifyLicense && license && (
                    <a href={dreLookupUrl(license)} target="_blank" rel="noopener" className="link-chevron mt-auto pt-5 text-[15px]">
                      Verify license #{license}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )}
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
        {records.length > 0 && (
          <div className="mx-auto mt-12 max-w-[1080px]">
            <h3 className="text-[21px] font-semibold">Recent closings</h3>
            <ul className="mt-4 divide-y divide-pro-hairline border-y border-pro-hairline">
              {records.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 text-[15px]">
                  <span className="text-titanium">{r.closedYear}</span>
                  <span className="flex-1">{r.assetType}</span>
                  <span className="text-titanium">{r.program}</span>
                  <span className="font-semibold">{formatUsd(r.loanAmountUsd)}</span>
                </li>
              ))}
            </ul>
            <Link href="/track-record" className="link-chevron mt-5 inline-flex text-[15px]">
              See our track record
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
