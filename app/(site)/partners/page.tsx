import type { Metadata } from "next";
import { PartnerPortal } from "@/components/partners/PartnerPortal";

export const metadata: Metadata = {
  title: "Partner Portal",
  description: "Register as a wholesale lender, referral broker, operator, or third-party vendor with Kubera Commercial.",
};

export default function PartnersPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <p className="eyebrow">Partner portal</p>
        <h1 className="mt-4 text-5xl font-semibold leading-[1.06] tracking-tight md:text-6xl">Plug into the deal flow.</h1>
        <p className="mt-5 text-lg text-titanium">
          Every registration lands in our CRM and feeds Jev, our routing engine — so the right deals reach your desk, with your fees protected.
        </p>
      </div>
      <div className="mt-14">
        <PartnerPortal />
      </div>
    </div>
  );
}
