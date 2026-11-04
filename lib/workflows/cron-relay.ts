// Frequent scheduled jobs, run by Inngest instead of Vercel Cron.
//
// Vercel's Hobby plan only accepts cron jobs that run once a day, so
// vercel.json keeps a daily run of every job as a floor and Inngest runs the
// frequent cadence below. Each function calls the job's own route handler in
// process with `Authorization: Bearer $CRON_SECRET`, so the handlers, their
// auth check and their responses stay the single source of truth, and no
// request leaves the deployment (deployment protection cannot block it).
//
// The handlers are written to tolerate overlapping runs (documents and
// approvals are leased or keyed in the database), so the daily Vercel run and
// an Inngest run landing together is harmless.
//
// The every-minute jobs on Vercel Pro (notify sweep, document scan) run every
// 5 minutes here to stay inside Inngest's free tier. Both are backstops: the
// in-request triggers and the approval executor do the immediate work.

import { NonRetriableError } from "inngest";
import { inngest } from "./client";

type CronRoute = { GET: (req: Request) => Promise<Response> };

export type CronRelayJob = {
  id: string;
  path: string;
  cron: string;
  load: () => Promise<CronRoute>;
};

export const CRON_RELAY_JOBS: readonly CronRelayJob[] = [
  { id: "cron-rates", path: "/api/cron/rates", cron: "*/15 * * * *", load: () => import("@/app/api/cron/rates/route") },
  { id: "cron-crm-retry", path: "/api/cron/crm-retry", cron: "7,37 * * * *", load: () => import("@/app/api/cron/crm-retry/route") },
  { id: "cron-approvals-expire", path: "/api/cron/approvals-expire", cron: "4,19,34,49 * * * *", load: () => import("@/app/api/cron/approvals-expire/route") },
  { id: "cron-notify-sweep", path: "/api/notify/sweep", cron: "*/5 * * * *", load: () => import("@/app/api/notify/sweep/route") },
  { id: "cron-documents-scan", path: "/api/documents/scan", cron: "1-59/5 * * * *", load: () => import("@/app/api/documents/scan/route") },
  { id: "cron-outreach-sweep", path: "/api/outreach/sweep", cron: "2-59/5 * * * *", load: () => import("@/app/api/outreach/sweep/route") },
  { id: "cron-mlds-clock", path: "/api/cron/mlds-clock", cron: "53 * * * *", load: () => import("@/app/api/cron/mlds-clock/route") },
];

/** Calls a job's route handler the way Vercel Cron would. Throws on a non-2xx answer so Inngest records the failure. */
export async function runCronJob(job: Pick<CronRelayJob, "path" | "load">, env: Record<string, string | undefined> = process.env): Promise<{ path: string; status: number }> {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) throw new NonRetriableError(`CRON_SECRET is not set; ${job.path} cannot run`);
  const route = await job.load();
  const res = await route.GET(new Request(`https://cron.internal${job.path}`, { headers: { authorization: `Bearer ${secret}` } }));
  if (!res.ok) throw new Error(`${job.path} answered ${res.status}`);
  return { path: job.path, status: res.status };
}

export function createCronRelayFunctions(jobs: readonly CronRelayJob[] = CRON_RELAY_JOBS) {
  const client = inngest();
  return jobs.map((job) =>
    client.createFunction(
      {
        id: job.id,
        name: `Scheduled job ${job.path}`,
        triggers: [{ cron: job.cron }],
        // A slow run is never stacked on by the next tick.
        concurrency: { limit: 1 },
        // The next tick is the retry.
        retries: 0,
      },
      async () => runCronJob(job),
    ),
  );
}
