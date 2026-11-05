import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth/dal";
import { californiaDate, can } from "@/lib/auth/policy";
import {
  AI_TASKS,
  CLASSIFICATION_LABELS,
  isAiTaskId,
  MODEL_TIER_LABELS,
  PROVIDER_LABELS,
  taskModelOverview,
  taskModelStore,
  type TaskModelOverview,
  type TaskModelSetting,
} from "@/lib/ai/model-settings";
import { DEFAULT_MODEL_CHOICE, MODEL_REASON_MAX } from "@/lib/ai/model-settings-admin";
import { providerForModel } from "@/lib/ai/routing";
import { saveTaskModelAction } from "./actions";

export const metadata: Metadata = { title: "AI models" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });

const ERRORS: Record<string, string> = {
  forbidden: "Only administrators can change which model a task uses.",
  reason_required: "Add a reason for the change, so the next person knows why the model moved.",
  model_not_allowed: "That model is not allowed for this task. Pick one from the list.",
  no_change: "That is already the setting for this task, so nothing was saved.",
  unknown_task: "That task could not be found. Reload the page and try again.",
  not_configured: "Model choices need the database on this deployment, so nothing was saved.",
  save_failed: "The change could not be saved. Try again; if it keeps failing, check the server log.",
  mfa: "Confirm two-step verification, then try again.",
  signed_out: "Your session ended. Sign in again.",
  bad_request: "That form could not be read. Reload the page and try again.",
};

const slugOf = (task: string) => task.replace(/[^a-z0-9]+/g, "-");

export default function AiModelSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <div className="mb-6">
        <p className="eyebrow">
          <Link href="/settings" className="hover:underline">
            Settings
          </Link>
        </p>
        <h1 className="font-display text-[32px] font-semibold text-ink">AI models</h1>
        <p className="mt-1 max-w-3xl text-[15px] text-titanium">
          Which model each AI task runs on. Every task starts on its default. An administrator can move a task to another model, with a reason, and the history
          below each task records who changed what and why. A task only offers models on the approved list that the data-protection routing rules allow for that
          task&rsquo;s data, so restricted documents, for example, always stay on Claude. Running jobs pick up a change within a minute.
        </p>
      </div>
      <Suspense fallback={<div className="bento h-72 animate-pulse" aria-label="Loading the AI model settings" />}>
        <Settings searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Settings({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await requireStaff("/settings/ai");
  const manage = can(ctx.principal, "manage_ai_settings", californiaDate(new Date()));

  let configured: boolean;
  let rows: TaskModelOverview[];
  try {
    const store = await taskModelStore();
    configured = store !== null;
    rows = await taskModelOverview(store);
  } catch (err) {
    console.error("[settings/ai] could not load the model settings:", err instanceof Error ? err.message : err);
    return (
      <div role="alert" className="bento p-8 text-danger">
        The model settings could not be loaded. Try again in a moment.
      </div>
    );
  }

  const saved = typeof sp.saved === "string" && isAiTaskId(sp.saved) ? rows.find((r) => r.id === sp.saved) : undefined;
  const errorTask = typeof sp.task === "string" && isAiTaskId(sp.task) ? AI_TASKS[sp.task].label : null;
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? "Something went wrong. Try again.") : null;
  const canEdit = manage.ok && configured;

  return (
    <>
      {saved ? (
        <p role="status" className="notice-success mb-5 rounded-xl px-4 py-3 text-[14px]">
          Saved. {saved.task.label} now runs on {saved.resolution.model}
          {saved.resolution.source === "default" ? " (its default)" : ""}.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice-danger mb-5 rounded-xl px-4 py-3 text-[14px]">
          {errorTask ? `${errorTask}: ` : ""}
          {error}
        </p>
      ) : null}
      {!configured ? (
        <p className="notice mb-5 rounded-xl px-4 py-3 text-[14px]">
          Model choices are stored in the database, which is not configured on this deployment (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY). Every task runs on
          its default until it is.
        </p>
      ) : !manage.ok ? (
        <p className="notice mb-5 rounded-xl px-4 py-3 text-[14px]">{manage.reason} This page shows what each task runs on.</p>
      ) : null}

      <ul className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-label="AI tasks">
        {rows.map((row) => (
          <li key={row.id} className="min-w-0">
            <TaskCard row={row} canEdit={canEdit} />
          </li>
        ))}
      </ul>
    </>
  );
}

function TaskCard({ row, canEdit }: { row: TaskModelOverview; canEdit: boolean }) {
  const { task, resolution: r } = row;
  const slug = slugOf(row.id);
  const headingId = `task-${slug}`;
  const stored = r.setting?.model ?? null;
  const selected = stored && row.allowed.some((m) => m.id === stored) ? stored : DEFAULT_MODEL_CHOICE;
  const providers = [...new Set(row.allowed.map((m) => providerForModel(m.id)).filter((p) => p !== null))].map((p) => PROVIDER_LABELS[p]);

  return (
    <article id={slug} className="bento p-6" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className={`${r.source === "setting" ? "badge-success" : "badge"} rounded-full px-2.5 py-0.5 font-medium`}>
          {r.source === "setting" ? "Chosen by an administrator" : "Default"}
        </span>
        <span className={`${task.dataCeiling === "restricted" ? "badge-warning" : "badge"} rounded-full px-2.5 py-0.5 font-medium`}>
          Data ceiling: {CLASSIFICATION_LABELS[task.dataCeiling]}
        </span>
      </div>
      <h2 id={headingId} className="mt-2 text-[18px] font-semibold leading-snug text-ink">
        {task.label}
      </h2>
      <p className="mt-1 max-w-3xl text-[14px] text-titanium">{task.description}</p>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className="text-titanium">Current model</dt>
        <dd className="min-w-0 break-words text-ink" data-testid={`current-${slug}`}>
          <code className="font-mono text-[13px]">{r.model}</code>
          {r.source === "default" ? " (default)" : " (chosen)"}
        </dd>
        <dt className="text-titanium">Default</dt>
        <dd className="min-w-0 break-words text-ink">
          <code className="font-mono text-[13px]">{r.defaultModel}</code> {row.defaultFromEnv ? `(set by ${row.defaultFromEnv})` : "(built in)"}
        </dd>
        <dt className="text-titanium">Data ceiling</dt>
        <dd className="min-w-0 text-ink">
          {CLASSIFICATION_LABELS[task.dataCeiling]}. {task.dataNote}
        </dd>
        <dt className="text-titanium">Can run on</dt>
        <dd className="min-w-0 text-ink">{providers.length ? providers.join(", ") : "Its default only"}</dd>
      </dl>

      {r.ignored ? (
        <p role="note" className="notice-warning mt-4 rounded-xl px-4 py-3 text-[14px]">
          The saved choice, {r.ignored.model}, is no longer allowed for this task, so it runs on its default. Choose a model to replace it.
        </p>
      ) : null}

      {canEdit ? (
        <form action={saveTaskModelAction} className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto] sm:items-end">
          <input type="hidden" name="task" value={row.id} />
          <div className="min-w-0">
            <label htmlFor={`model-${slug}`} className="field-label">
              Model <span className="sr-only">for {task.label}</span>
            </label>
            <select id={`model-${slug}`} name="model" defaultValue={selected} required className="field">
              <option value={DEFAULT_MODEL_CHOICE}>Use the default ({r.defaultModel})</option>
              {row.allowed.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} ({MODEL_TIER_LABELS[m.tier]})
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor={`reason-${slug}`} className="field-label">
              Reason for the change <span className="sr-only">to {task.label}</span>
            </label>
            <input
              id={`reason-${slug}`}
              name="reason"
              required
              maxLength={MODEL_REASON_MAX}
              autoComplete="off"
              className="field"
              aria-describedby={`reason-hint-${slug}`}
            />
            <p id={`reason-hint-${slug}`} className="sr-only">
              Required. Recorded in the history with your name.
            </p>
          </div>
          <button type="submit" className="pill pill-primary min-h-11 px-5 py-2 text-[15px]">
            Save <span className="sr-only">{task.label}</span>
          </button>
        </form>
      ) : null}

      <History slug={slug} label={task.label} rows={row.history} />
    </article>
  );
}

function History({ slug, label, rows }: { slug: string; label: string; rows: TaskModelSetting[] }) {
  const titleId = `history-${slug}`;
  return (
    <section className="mt-5" aria-labelledby={titleId}>
      <h3 id={titleId} className="text-[13px] font-semibold uppercase tracking-wide text-titanium">
        Recent changes <span className="sr-only">to {label}</span>
      </h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-[14px] text-titanium">No changes yet: this task has always run on its default.</p>
      ) : (
        <div className="-mx-1 mt-1 overflow-x-auto" role="region" tabIndex={0} aria-label={`Recent changes to ${label}`}>
          <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b border-black/10 text-[12px] uppercase tracking-wide text-titanium">
                <th scope="col" className="px-1 py-2 font-medium">
                  When
                </th>
                <th scope="col" className="px-1 py-2 font-medium">
                  Who
                </th>
                <th scope="col" className="px-1 py-2 font-medium">
                  From
                </th>
                <th scope="col" className="px-1 py-2 font-medium">
                  To
                </th>
                <th scope="col" className="px-1 py-2 font-medium">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h, i) => (
                <tr key={`${h.setAt}-${i}`} className="border-b border-black/5 align-top">
                  <td className="whitespace-nowrap px-1 py-2">
                    <time dateTime={h.setAt}>{dateFmt.format(new Date(h.setAt))}</time>
                  </td>
                  <td className="px-1 py-2">{h.setByLabel}</td>
                  <td className="break-all px-1 py-2 font-mono text-[13px]">{h.previousModel}</td>
                  <td className="break-all px-1 py-2 font-mono text-[13px]">{h.model ?? "Default"}</td>
                  <td className="break-words px-1 py-2">{h.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
