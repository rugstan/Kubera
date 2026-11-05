# AI models: which model each task uses

Use this when someone asks which model a task runs on, wants to move a task to another model, or needs to undo a change.

## Where to change it

Staff app → **Settings** → **AI models** (`/settings/ai`). Every staff member can see the page; only an **administrator** can change it. Each task card shows its current model, its default, its data ceiling, the models it may use and its last five changes (who, when, from, to, reason).

To change a task: pick a model, write a reason (required, kept in the history), press **Save**. To undo: pick **Use the default** and save. Nothing is ever edited or deleted; every change is a new row in the append-only `ai_task_models` table (service role only, RLS on, `supabase/migrations/20261105110000_int_ai_task_models.sql`).

Running jobs pick up a change within a minute (each server instance caches the settings for 60 seconds). Without a database (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` unset) the page is read-only and every task runs on its default. In fake-auth mode (demo, e2e) choices live in memory until the server restarts.

## How a task's model is decided

1. The code default (the gateway tiers in `lib/ai/gateway.ts`).
2. The env override, where one exists: `DOCUMENT_TEXT_MODEL` (text extraction) and `XAI_MODEL` (market intel).
3. The latest administrator choice, if that model is still allowed.

A choice is only offered, saved and used when the model is on the approved list (`approvedModels()` in `lib/agents/core/registry.ts`: the three Claude tiers, `NVIDIA_NIM_MODEL` when set, and the xAI model; xAI for market intel only), the task's call path can reach its provider, and the routing guard (`lib/ai/routing.ts`) accepts that provider for the task's purpose at the task's data ceiling. The check runs again every time a choice is read: if a model later leaves the approved list (for example `NVIDIA_NIM_MODEL` is unset), the task falls back to its default and the server logs a `[model-settings]` warning; the page flags the stale choice.

## Tasks and defaults

| Task (id) | Default | Data ceiling | Can run on |
| --- | --- | --- | --- |
| Staff assistant (`advisor.chat`) | `claude-opus-5-5` | Confidential | Claude only (calls Anthropic directly) |
| Mail triage (`mail.triage`) | `claude-haiku-5-5` | Confidential | Claude; NVIDIA NIM when configured |
| Document extraction, text (`documents.extract_text`) | `DOCUMENT_TEXT_MODEL`, else `claude-opus-5-5` | Restricted | Claude only (PFS and tax returns) |
| Document extraction, scanned PDF (`documents.extract_pdf`) | `claude-opus-5-5` | Restricted | Claude only (the PDF itself is sent) |
| Term-sheet parser (`lenders.term_sheet`) | `claude-opus-5-5` | Confidential | Claude; NVIDIA NIM when configured |
| Prospect intro (`prospecting.intro`) | `claude-sonnet-5-5` | Internal | Claude; NVIDIA NIM when configured |
| CRM call summary (`crm.call_summary`) | `claude-sonnet-5-5` | Confidential | Claude; NVIDIA NIM when configured |
| Market intel note (`intel.market_draft`) | `XAI_MODEL`, else `grok-4` | Public | xAI only (public signals) |

Restricted documents never leave Claude: even when `DOCUMENT_TEXT_MODEL` names an NVIDIA model, the pipeline sends a PFS or tax return to Claude.

## Where the model a call used is recorded

Prompt versions pin the prompt text and register the default model; a chosen model runs under the same version and every call records what it actually ran on: `agent_events.model` (the prompt ref), `mail_messages.classifier_model`, `document_extractions.model`, `quotes.parser_model`, `intel_drafts.model` / `served_model`, `prospect_outreach.model`, the assistant's stored transcript, and Langfuse (served model, with the requested model in the metadata).

## Adding a model or a task

- A new model: add it to the tiers in `lib/ai/gateway.ts` (or set `NVIDIA_NIM_MODEL` / `XAI_MODEL`); it then appears wherever the routing guard allows it.
- A new AI task: add it to `AI_TASKS` in `lib/ai/model-settings.ts` (default, purpose, providers, data ceiling) and call `resolveTaskModel("<task id>")` at the call site instead of a constant.
