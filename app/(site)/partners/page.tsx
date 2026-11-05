import type { Metadata } from "next";
import { PartnerPortal } from "@/components/partners/PartnerPortal";
import { PageContainer } from "@/components/site/PageContainer";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Lender, broker and vendor partner portal",
  description: "Register with Corin Commercial as a wholesale lender, referral broker, operator or third-party vendor, and work with a licensed California commercial loan broker.",
  path: "/partners",
});

export default function PartnersPage() {
  return (
    <PageContainer className="py-20 md:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <p className="eyebrow">Partner portal</p>
        <h1 className="mt-4 text-5xl font-semibold leading-[1.06] md:text-6xl">Plug into the deal flow.</h1>
        <p className="mt-5 text-lg text-titanium">
          Every registration is reviewed by our team, so the deals that fit your criteria reach your desk. Compensation is always set by signed agreement.
        </p>
      </div>
      <div className="mt-14">
        <PartnerPortal />
      </div>
    </PageContainer>
  );
}
