// Shared sample data for disclosure tests (not imported by application code).

import type { FunderDisclosureInput } from "./funder";
import type { MldsInput } from "./mlds";

export const sampleMldsInput: MldsInput = {
  preparedOn: "2026-11-02",
  borrowers: [
    { name: "Sunrise Senior Living Holdings, LLC", email: "cfo@sunrise.example" },
    { name: "Priya Shah, Managing Member", email: "priya@sunrise.example" },
  ],
  property: { address: "1200 Ocean View Blvd, Pacific Grove, CA 93950", apn: "006-123-045", county: "Monterey" },
  broker: {
    legalName: "Kubera Commercial, Inc.",
    dreLicense: "02234567",
    licensedAddress: "100 Market St, Suite 300, San Francisco, CA 94105",
    representativeName: "Neeli Khanna",
    representativeLicense: "02123456",
  },
  loan: {
    lenderName: "Pacific Bridge Partners LLC",
    principalUsd: 8_500_000,
    termMonths: 24,
    amortizationMonths: 0,
    ratePct: 9.75,
    rateType: "fixed",
    payment: { amountUsd: 69_062.5, frequency: "monthly", count: 23, interestOnly: true },
    balloon: { present: true, amountUsd: 8_569_062.5, dueOn: "2028-12-01" },
    prepayment: { present: true, description: "Six months' minimum interest" },
    lateCharge: { present: true, description: "5% of the late installment after 10 days" },
  },
  costs: {
    appraisal: { amountUsd: 7_500 },
    escrow: { amountUsd: 6_200 },
    title: { amountUsd: 14_800 },
    notary: { amountUsd: 350 },
    recording: { amountUsd: 600 },
    creditInvestigation: { amountUsd: 450, paidTo: "broker" },
    other: [{ label: "Property condition report", amountUsd: 3_200, paidTo: "others" }],
  },
  compensation: {
    brokerFromBorrower: { commissionUsd: 85_000, processingUsd: 1_500 },
    brokerFromLender: { amountUsd: 42_500, description: "Lender-paid origination split, 0.50% of principal" },
    lenderFees: { originationUsd: 85_000, discountUsd: 0 },
  },
  payoffs: [{ label: "Payoff of existing first deed of trust (Coastal Bank)", amountUsd: 6_100_000 }],
  existingLiens: [{ lienholder: "Coastal Bank", nature: "Deed of trust", priority: 1, amountUsd: 6_100_000 }],
  expectedLiens: [{ lienholder: "Pacific Bridge Partners LLC", nature: "Deed of trust", priority: 1, amountUsd: 8_500_000 }],
};

export const sampleFunderInput: FunderDisclosureInput = {
  preparedOn: "2026-11-02",
  borrowers: [{ name: "Sunrise Senior Living Holdings, LLC", email: "cfo@sunrise.example" }],
  lenderOfRecord: { name: "Pacific Bridge Partners LLC", category: "PRIVATE_NON_EXEMPT", licenseOrCharter: "CFL 60DBO-000000" },
  beneficiaryName: "Pacific Bridge Partners LLC",
  tableFunded: false,
  lenderPaidCompensationUsd: 42_500,
  escrowAgent: "First American Title, Monterey",
};
