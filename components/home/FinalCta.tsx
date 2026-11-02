import { contactDetails } from "@/content/contact";
import { TEAM, isPlaceholderBio, licenseDisplay } from "@/content/team";
import { site } from "@/lib/site";
import { Reveal } from "./Reveal";
import { TrackedLink } from "./TrackedLink";

/** The advisor line shows only for a real bio with a verified DRE number. */
function advisorLine(): string | null {
  const lead = TEAM[0];
  if (!lead || isPlaceholderBio(lead.bio)) return null;
  const license = licenseDisplay(lead);
  return license.kind === "verified" ? `Your advisor: ${lead.name}, ${lead.title}, DRE #${license.id}` : null;
}

export function FinalCta() {
  const contact = contactDetails();
  const advisor = advisorLine();
  return (
    <section aria-labelledby="final-cta-title" className="bg-white py-20 md:py-32">
      <Reveal className="mx-auto max-w-[980px] px-5 text-center md:px-8">
        <h2 id="final-cta-title" className="text-headline font-semibold md:text-section">
          Tell us about your deal.
        </h2>
        <p className="mx-auto mt-4 max-w-3xl text-[17px] text-titanium md:text-lede">
          An advisor reviews every request and replies with the programs and lenders that may fit. No credit check to start, and no obligation.
        </p>
        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
          <TrackedLink href="/express" cta="get_options" section="final" className="pill pill-primary">Get loan options</TrackedLink>
          <TrackedLink href="/contact#schedule" cta="book_call" section="final" className="pill pill-secondary">Book a call</TrackedLink>
        </div>
        <p className="mt-6 text-[15px] text-titanium">
          Or email{" "}
          <a href={`mailto:${site.email}`} className="text-accent underline-offset-2 hover:underline">
            {site.email}
          </a>
          {contact.telHref && (
            <>
              {" · call "}
              <a href={`tel:${contact.telHref}`} className="text-accent underline-offset-2 hover:underline">
                {contact.phone}
              </a>
            </>
          )}
        </p>
        {advisor && <p className="mt-2 text-[13px] text-titanium">{advisor}</p>}
      </Reveal>
    </section>
  );
}
