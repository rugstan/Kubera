// Field specifications per document type. The rules extractor, the model
// prompt + JSON schema, validation and the review queue are all driven from
// these specs, so a field is defined exactly once.
//
// Sign convention: deductions (vacancy, concessions, bad debt, loss to lease)
// and expenses are stored as positive amounts; formulas subtract them.

import type { DocType, DocTypeSpec, FieldKind, FieldSpec, RowSpec } from "./types";

const f = (key: string, label: string, kind: FieldKind, synonyms: readonly string[], extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  label,
  kind,
  synonyms,
  ...extra,
});

// --- T-12 operating statement ---------------------------------------------------------

export const T12_INCOME_KEYS = ["grossPotentialRent", "roomsRevenue", "foodBeverageRevenue", "otherIncome"] as const;
export const T12_DEDUCTION_KEYS = ["vacancyLoss", "lossToLease", "concessions", "badDebt"] as const;
export const T12_EXPENSE_KEYS = [
  "realEstateTaxes",
  "insurance",
  "utilities",
  "repairsMaintenance",
  "payroll",
  "management",
  "generalAdmin",
  "marketing",
  "contractServices",
  "franchiseFees",
  "replacementReserves",
  "otherExpenses",
] as const;

const T12: DocTypeSpec = {
  docType: "T12",
  label: "trailing-12-month operating statement (T-12)",
  classification: "confidential",
  keywords: ["operating statement", "t12", "t 12", "trailing 12", "income statement", "net operating income", "noi", "total operating expenses", "profit and loss", "p l"],
  scalars: [
    f("propertyName", "Property name", "string", ["property", "property name"]),
    f("periodEnd", "Period end", "date", ["period ending", "period end", "for the period ending", "as of"], { hint: "Last day of the 12-month period." }),
    f("months", "Months covered", "integer", ["months"], { hint: "Number of months the statement covers (12 for a T-12)." }),
    f("grossPotentialRent", "Gross potential rent", "money", [
      "gross potential rent",
      "gross potential rental income",
      "gpr",
      "potential rental income",
      "gross scheduled rent",
      "scheduled rent",
      "rental income",
      "gross rent",
      "gross rents",
      "rent revenue",
      "resident revenue",
      "resident fees",
      "base rent",
    ]),
    f("vacancyLoss", "Vacancy loss", "money", ["vacancy", "vacancy loss", "physical vacancy", "less vacancy", "vacancy and collection loss"], { hint: "Positive amount deducted from rent." }),
    f("lossToLease", "Loss to lease", "money", ["loss to lease", "gain loss to lease", "gain to lease"], { hint: "Positive amount deducted from rent." }),
    f("concessions", "Concessions", "money", ["concessions", "rent concessions", "free rent"], { hint: "Positive amount deducted from rent." }),
    f("badDebt", "Bad debt / credit loss", "money", ["bad debt", "credit loss", "collection loss", "write offs", "bad debt expense"], { hint: "Positive amount deducted from rent." }),
    f("roomsRevenue", "Rooms revenue (hotel)", "money", ["rooms revenue", "room revenue", "rooms"]),
    f("foodBeverageRevenue", "Food & beverage revenue (hotel)", "money", ["food beverage revenue", "food and beverage revenue", "f b revenue", "food beverage", "food and beverage"]),
    f("otherIncome", "Other income", "money", [
      "other income",
      "other revenue",
      "ancillary income",
      "miscellaneous income",
      "parking income",
      "laundry income",
      "utility reimbursement",
      "rubs",
      "fee income",
    ]),
    f("effectiveGrossIncome", "Effective gross income", "money", [
      "effective gross income",
      "egi",
      "total income",
      "total revenue",
      "total revenues",
      "total operating income",
      "total operating revenue",
    ]),
    f("realEstateTaxes", "Real estate taxes", "money", ["real estate taxes", "property taxes", "taxes", "re taxes", "real estate tax", "property tax"]),
    f("insurance", "Insurance", "money", ["insurance", "property insurance", "insurance expense"]),
    f("utilities", "Utilities", "money", ["utilities", "utility expense", "electric", "water and sewer", "gas and electric"]),
    f("repairsMaintenance", "Repairs & maintenance", "money", ["repairs and maintenance", "repairs maintenance", "r m", "maintenance", "repairs", "turnover"]),
    f("payroll", "Payroll", "money", ["payroll", "salaries and wages", "salaries", "wages", "payroll and benefits", "personnel"]),
    f("management", "Management fee", "money", ["management fee", "management fees", "property management", "management"]),
    f("generalAdmin", "General & administrative", "money", ["general and administrative", "g a", "administrative", "general administrative", "office expense"]),
    f("marketing", "Marketing", "money", ["marketing", "advertising", "advertising and marketing", "sales and marketing"]),
    f("contractServices", "Contract services", "money", ["contract services", "contracted services", "landscaping", "security", "pest control"]),
    f("franchiseFees", "Franchise fees (hotel)", "money", ["franchise fees", "franchise fee", "royalty fees", "brand fees"]),
    f("replacementReserves", "Replacement reserves", "money", ["replacement reserves", "reserves", "reserve for replacement", "ff e reserve", "ffe reserve"]),
    f("otherExpenses", "Other expenses", "money", ["other expenses", "other expense", "miscellaneous expense", "miscellaneous"]),
    f("totalOperatingExpenses", "Total operating expenses", "money", ["total operating expenses", "total expenses", "total opex", "operating expenses total", "total operating expense"]),
    f("noi", "Net operating income", "money", ["net operating income", "noi", "net income from operations"], { required: true }),
    f("capitalExpenditures", "Capital expenditures (below the line)", "money", ["capital expenditures", "capex", "capital improvements"]),
  ],
};

// --- Rent roll ------------------------------------------------------------------------------

const RENT_ROLL_UNITS: RowSpec = {
  key: "units",
  label: "Units",
  requiredColumns: ["unit"],
  ignoredColumns: ["tenant", "tenant name", "resident", "resident name", "name", "lessee", "phone", "email"],
  columns: [
    f("unit", "Unit", "string", ["unit", "unit number", "unit no", "unit", "apt", "apartment", "suite", "space"], { required: true }),
    f("unitType", "Unit type", "string", ["unit type", "type", "floorplan", "floor plan", "plan", "bd ba", "bed bath"]),
    f("beds", "Bedrooms", "number", ["beds", "bedrooms", "bed", "br", "bd"]),
    f("baths", "Bathrooms", "number", ["baths", "bathrooms", "bath", "ba"]),
    f("sqft", "Square feet", "number", ["sqft", "sq ft", "square feet", "sf", "size", "area"]),
    f("status", "Status", "string", ["status", "occupancy", "occupancy status", "unit status"], { hint: "occupied, vacant, notice, model, down or employee." }),
    f("marketRent", "Market rent (monthly)", "money", ["market rent", "market", "asking rent", "scheduled rent", "street rent"]),
    f("inPlaceRent", "In-place rent (monthly)", "money", ["contract rent", "actual rent", "lease rent", "current rent", "in place rent", "rent", "charged rent", "effective rent"]),
    f("concession", "Monthly concession", "money", ["concession", "concessions", "monthly concession", "discount"]),
    f("balanceDue", "Balance due", "money", ["balance", "balance due", "past due", "delinquent", "delinquency", "amount due", "ar balance"]),
    f("leaseStart", "Lease start", "date", ["lease start", "lease from", "start date", "lease begin"]),
    f("leaseEnd", "Lease end", "date", ["lease end", "lease to", "lease expiration", "expiration", "end date", "lease exp"]),
    f("moveIn", "Move-in", "date", ["move in", "move in date", "movein"]),
  ],
};

const RENT_ROLL: DocTypeSpec = {
  docType: "RENT_ROLL",
  label: "multifamily rent roll",
  classification: "confidential",
  keywords: ["rent roll", "unit", "market rent", "lease start", "lease end", "move in", "sq ft", "contract rent", "unit type", "occupied", "vacant"],
  scalars: [
    f("propertyName", "Property name", "string", ["property", "property name"]),
    f("asOfDate", "As-of date", "date", ["as of", "as of date", "report date", "rent roll as of"], { required: true }),
    f("totalUnits", "Total units", "integer", ["total units", "units", "unit count"]),
  ],
  rows: RENT_ROLL_UNITS,
};

// --- Senior housing census ---------------------------------------------------------------

const CENSUS: DocTypeSpec = {
  docType: "CENSUS",
  label: "senior housing / skilled nursing census and payor report",
  classification: "confidential",
  keywords: ["census", "payor", "payer", "medicaid", "medicare", "private pay", "care level", "level of care", "assisted living", "memory care", "licensed beds", "resident"],
  scalars: [
    f("propertyName", "Facility name", "string", ["facility", "facility name", "community", "property"]),
    f("asOfDate", "As-of date", "date", ["as of", "census date", "report date", "as of date"], { required: true }),
    f("licensedBeds", "Licensed beds", "integer", ["licensed beds", "licensed capacity", "beds", "total beds"]),
    f("totalUnits", "Total units", "integer", ["total units", "units", "unit count"]),
  ],
  rows: {
    key: "residents",
    label: "Census rows",
    requiredColumns: ["room"],
    ignoredColumns: ["resident", "resident name", "name", "patient", "patient name", "dob", "date of birth", "ssn", "medicaid id", "medicare id", "mrn"],
    columns: [
      f("room", "Room / unit", "string", ["room", "unit", "apt", "bed", "room number", "suite"], { required: true }),
      f("careLevel", "Care level", "string", ["care level", "level of care", "level", "care type", "service level", "unit type"], { hint: "IL, AL, MC, SNF or RESPITE." }),
      f("payor", "Payor", "string", ["payor", "payer", "payor source", "pay source", "funding", "payer type"], { hint: "PRIVATE, MEDICAID, MEDICARE, VA, LTC_INSURANCE, MANAGED_CARE or OTHER." }),
      f("status", "Status", "string", ["status", "occupancy"], { hint: "occupied or vacant." }),
      f("monthlyRate", "Monthly rate", "money", ["monthly rate", "rate", "monthly rent", "monthly fee", "rent", "charge"]),
      f("residents", "Residents in the room", "integer", ["residents", "occupants", "census"]),
    ],
  },
};

// --- STR (hotel STAR report) ------------------------------------------------------------

const STR: DocTypeSpec = {
  docType: "STR",
  label: "hotel STR / STAR report (monthly performance vs. competitive set)",
  classification: "confidential",
  keywords: ["str", "star report", "revpar", "adr", "occupancy", "comp set", "competitive set", "mpi", "ari", "rgi", "index"],
  scalars: [
    f("propertyName", "Hotel name", "string", ["hotel", "property", "property name"]),
    f("rooms", "Rooms (keys)", "integer", ["rooms", "keys", "room count", "total rooms"]),
  ],
  rows: {
    key: "months",
    label: "Months",
    requiredColumns: ["month"],
    columns: [
      f("month", "Month", "month", ["month", "period", "date"], { required: true }),
      f("occupancy", "Occupancy", "percent", ["occupancy", "occ", "my property occ", "occupancy my property", "property occupancy"]),
      f("adr", "ADR", "money", ["adr", "average daily rate", "my property adr", "property adr"]),
      f("revpar", "RevPAR", "money", ["revpar", "rev par", "my property revpar", "property revpar"]),
      f("compOccupancy", "Comp set occupancy", "percent", ["comp occupancy", "comp set occ", "comp occ", "competitive set occupancy", "comp set occupancy"]),
      f("compAdr", "Comp set ADR", "money", ["comp adr", "comp set adr", "competitive set adr"]),
      f("compRevpar", "Comp set RevPAR", "money", ["comp revpar", "comp set revpar", "competitive set revpar"]),
      f("roomsAvailable", "Rooms available", "integer", ["rooms available", "supply", "available rooms", "room nights available"]),
      f("roomsSold", "Rooms sold", "integer", ["rooms sold", "demand", "occupied rooms", "room nights sold"]),
      f("roomRevenue", "Room revenue", "money", ["room revenue", "rooms revenue", "revenue"]),
    ],
  },
};

// --- Personal financial statement (restricted) -------------------------------------------

const PFS: DocTypeSpec = {
  docType: "PFS",
  label: "personal financial statement of a guarantor",
  classification: "restricted",
  keywords: ["personal financial statement", "net worth", "total assets", "total liabilities", "contingent liabilities", "sba form 413", "assets", "liabilities", "cash on hand"],
  scalars: [
    f("asOfDate", "As-of date", "date", ["as of", "statement date", "date"], { required: true }),
    f("cashOnHand", "Cash on hand & in banks", "money", ["cash on hand", "cash", "cash in banks", "cash on hand and in banks", "checking", "savings"]),
    f("marketableSecurities", "Marketable securities", "money", ["marketable securities", "stocks and bonds", "securities", "investments", "brokerage"]),
    f("retirementAccounts", "Retirement accounts", "money", ["retirement accounts", "ira", "401k", "ira or other retirement account", "retirement"]),
    f("realEstateValue", "Real estate owned (market value)", "money", ["real estate", "real estate owned", "real estate value", "real estate holdings"]),
    f("businessInterests", "Business interests", "money", ["business interests", "closely held business", "business ownership", "partnership interests"]),
    f("otherAssets", "Other assets", "money", ["other assets", "personal property", "automobiles", "life insurance cash value"]),
    f("totalAssets", "Total assets", "money", ["total assets"], { required: true }),
    f("realEstateDebt", "Mortgages on real estate", "money", ["mortgages on real estate", "mortgages", "real estate debt", "mortgage debt"]),
    f("notesPayable", "Notes payable", "money", ["notes payable", "notes payable to banks", "loans payable", "installment debt", "auto loans"]),
    f("otherLiabilities", "Other liabilities", "money", ["other liabilities", "credit cards", "accounts payable", "unpaid taxes", "other debt"]),
    f("totalLiabilities", "Total liabilities", "money", ["total liabilities"], { required: true }),
    f("netWorth", "Net worth", "money", ["net worth", "total net worth"], { required: true }),
    f("annualSalary", "Annual salary", "money", ["salary", "annual salary", "wages", "employment income"]),
    f("annualOtherIncome", "Other annual income", "money", ["other income", "investment income", "net investment income", "rental income", "real estate income"]),
    f("annualPersonalDebtService", "Annual personal debt service", "money", ["annual debt service", "personal debt service", "annual payments", "monthly payments x 12"]),
    f("contingentLiabilities", "Contingent liabilities", "money", ["contingent liabilities", "guarantees", "as endorser or co maker", "legal claims"]),
  ],
};

// --- Construction / PIP budget -------------------------------------------------------------

export const BUDGET_CATEGORIES = ["land", "hard", "soft", "contingency", "developer_fee", "financing", "reserve"] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

const CONSTRUCTION_BUDGET: DocTypeSpec = {
  docType: "CONSTRUCTION_BUDGET",
  label: "construction, renovation or PIP development budget (sources and uses)",
  classification: "confidential",
  keywords: ["budget", "hard costs", "soft costs", "contingency", "developer fee", "sources and uses", "uses", "gmp", "general contractor", "architect", "permits", "land", "pip"],
  scalars: [
    f("landCost", "Land / acquisition", "money", ["land", "land cost", "land acquisition", "acquisition", "purchase price", "site acquisition"]),
    f("hardCosts", "Hard costs", "money", ["hard costs", "total hard costs", "construction costs", "hard cost", "gmp contract", "construction contract"]),
    f("softCosts", "Soft costs", "money", ["soft costs", "total soft costs", "soft cost"]),
    f("contingency", "Contingency", "money", ["contingency", "hard cost contingency", "total contingency", "construction contingency", "soft cost contingency"]),
    f("developerFee", "Developer fee", "money", ["developer fee", "development fee", "developer overhead"]),
    f("financingCosts", "Financing costs (interest reserve, loan fees)", "money", ["financing costs", "interest reserve", "loan fees", "financing fees", "construction interest", "capitalized interest"]),
    f("totalCost", "Total project cost", "money", ["total project cost", "total development cost", "total budget", "total costs", "total uses", "total project costs", "tdc", "total"], { required: true }),
    f("gmpContract", "Guaranteed maximum price contract", "boolean", ["gmp", "guaranteed maximum price"]),
  ],
  rows: {
    key: "lineItems",
    label: "Budget lines",
    requiredColumns: ["description", "amount"],
    optional: true,
    columns: [
      f("description", "Description", "string", ["description", "item", "line item", "cost item", "category", "budget item", "use"], { required: true }),
      f("category", "Category", "string", ["category", "cost type", "type", "group"], { hint: "land, hard, soft, contingency, developer_fee, financing or reserve." }),
      f("amount", "Amount", "money", ["amount", "budget", "cost", "total", "budget amount", "total cost"], { required: true }),
    ],
  },
};

// --- Lender term sheet ----------------------------------------------------------------------

const TERM_SHEET: DocTypeSpec = {
  docType: "TERM_SHEET",
  label: "lender term sheet or letter of interest",
  classification: "confidential",
  keywords: ["term sheet", "letter of interest", "loi", "indicative terms", "borrower", "lender", "loan amount", "interest rate", "amortization", "prepayment", "recourse", "origination fee"],
  scalars: [
    f("lenderName", "Lender", "string", ["lender", "lender name"]),
    f("loanAmount", "Loan amount", "money", ["loan amount", "maximum loan amount", "loan", "principal amount", "commitment amount"], { required: true }),
    f("interestRatePct", "Interest rate (%)", "rate", ["interest rate", "rate", "note rate", "coupon", "fixed rate"], { required: true, hint: "All-in note rate in percent, e.g. 6.25." }),
    f("rateType", "Rate type", "string", ["rate type", "interest rate type"], { hint: "fixed or floating." }),
    f("indexName", "Index", "string", ["index", "benchmark", "base rate"]),
    f("spreadBps", "Spread (bps)", "number", ["spread", "margin", "spread over index"], { hint: "Basis points over the index (4.25% = 425)." }),
    f("amortizationYears", "Amortization (years)", "number", ["amortization", "amortization period", "amortization schedule", "amort"], { hint: "0 when interest-only for the full term.", unit: "years" }),
    f("interestOnlyMonths", "Interest-only period (months)", "integer", ["interest only", "interest only period", "io period", "io"], { unit: "months" }),
    f("termMonths", "Term (months)", "integer", ["term", "loan term", "maturity", "initial term"], { unit: "months" }),
    f("originationFeePct", "Origination fee", "percent", ["origination fee", "lender fee", "origination", "points", "commitment fee"]),
    f("exitFeePct", "Exit fee", "percent", ["exit fee", "release fee", "exit"]),
    f("maxLtv", "Maximum LTV", "percent", ["max ltv", "maximum ltv", "ltv", "loan to value"]),
    f("minDscr", "Minimum DSCR", "number", ["dscr", "minimum dscr", "min dscr", "debt service coverage"]),
    f("minDebtYield", "Minimum debt yield", "percent", ["debt yield", "minimum debt yield", "min debt yield"]),
    f("prepayment", "Prepayment", "string", ["prepayment", "prepayment penalty", "prepay", "yield maintenance", "defeasance"]),
    f("recourse", "Recourse", "string", ["recourse", "guaranty", "guarantee"]),
  ],
};

export const DOC_SPECS: Readonly<Record<DocType, DocTypeSpec>> = {
  T12,
  RENT_ROLL,
  CENSUS,
  STR,
  PFS,
  CONSTRUCTION_BUDGET,
  TERM_SHEET,
};

export function specFor(docType: DocType): DocTypeSpec {
  return DOC_SPECS[docType];
}

/** Vault document kinds (lib/documents/types.ts) that name a document type. */
export const DOC_TYPE_BY_VAULT_KIND: Readonly<Record<string, DocType | undefined>> = {
  T12: "T12",
  RENT_ROLL: "RENT_ROLL",
  CENSUS: "CENSUS",
  STR_REPORT: "STR",
  PFS: "PFS",
  PIP_BUDGET: "CONSTRUCTION_BUDGET",
};

/** Registered extraction prompt version (lib/agents/documents/prompt.ts extractionPrompt); stored on every extraction row. */
export const EXTRACTION_PROMPT_SEMVER = "1.1.0";
export const PROMPT_VERSION = `documents.extract@${EXTRACTION_PROMPT_SEMVER}`;
