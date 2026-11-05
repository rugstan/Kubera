import { HOME_STEPS } from "@/content/home";
import { PageContainer } from "@/components/site/PageContainer";
import { Reveal } from "./Reveal";
import { TrackedLink } from "./TrackedLink";

export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works-title" className="bg-white py-20 md:py-32">
      <PageContainer>
        <Reveal className="mx-auto max-w-[980px] text-center">
          <p className="eyebrow">How it works</p>
          <h2 id="how-it-works-title" className="mt-3 text-headline font-semibold md:text-section">
            Tell us about the deal once. We take it to the lenders.
          </h2>
        </Reveal>
        <ol className="mt-12 grid gap-10 md:mt-16 md:grid-cols-2 md:gap-x-8 lg:grid-cols-4">
          {HOME_STEPS.map((s, i) => (
            <li key={s.title}>
              <Reveal delay={i * 0.05}>
                <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-ink text-[15px] font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-[21px] font-semibold leading-snug">{s.title}</h3>
                <p className="mt-2 text-[17px] text-titanium">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
        <div className="mt-12 flex justify-center md:mt-16">
          <TrackedLink href="/express" cta="get_options" section="process" className="pill pill-primary">Get loan options</TrackedLink>
        </div>
      </PageContainer>
    </section>
  );
}
