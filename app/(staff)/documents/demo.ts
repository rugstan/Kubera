// Demo vault contents for fake-auth mode. Illustrative only.

import { DEMO_DEAL_IDS } from "@/lib/approvals/demo";
import type { StaffDocument } from "./model";

const LEADS = {
  seniorLiving: "20000000-0000-4000-8000-000000000001",
  hotel: "20000000-0000-4000-8000-000000000002",
} as const;

export const DEMO_DOCUMENTS: StaffDocument[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    createdAt: "2026-10-30T17:02:00.000Z",
    kind: "T12",
    fileName: "Sunrise T-12 Sep 2026.pdf",
    contentType: "application/pdf",
    leadId: LEADS.seniorLiving,
    storagePath: `${LEADS.seniorLiving}/T12/demo-sunrise-t12.pdf`,
    dealId: DEMO_DEAL_IDS.seniorLiving,
    dealName: "Sunrise Senior Living (demo)",
    scanStatus: "clean",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    createdAt: "2026-10-30T17:05:00.000Z",
    kind: "CENSUS",
    fileName: "Sunrise census Oct 2026.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    leadId: LEADS.seniorLiving,
    storagePath: `${LEADS.seniorLiving}/CENSUS/demo-sunrise-census.xlsx`,
    dealId: DEMO_DEAL_IDS.seniorLiving,
    dealName: "Sunrise Senior Living (demo)",
    scanStatus: "clean",
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    createdAt: "2026-10-29T15:40:00.000Z",
    kind: "STR_REPORT",
    fileName: "Harbor Inn STR trailing 12.pdf",
    contentType: "application/pdf",
    leadId: LEADS.hotel,
    storagePath: `${LEADS.hotel}/STR_REPORT/demo-harbor-str.pdf`,
    dealId: DEMO_DEAL_IDS.hotel,
    dealName: "Harbor Inn (demo)",
    scanStatus: "clean",
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    createdAt: "2026-10-31T08:15:00.000Z",
    kind: "PIP_BUDGET",
    fileName: "Harbor Inn PIP budget.pdf",
    contentType: "application/pdf",
    leadId: LEADS.hotel,
    storagePath: `${LEADS.hotel}/PIP_BUDGET/demo-harbor-pip.pdf`,
    dealId: DEMO_DEAL_IDS.hotel,
    dealName: "Harbor Inn (demo)",
    scanStatus: "quarantined",
  },
];
