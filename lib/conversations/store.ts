import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FIELD_CLASSIFICATION, redactPayload, redactText, type Classification } from "@/lib/privacy/classification";
import { supabaseAdmin } from "@/lib/supabase/server";

// Server-side transcript store for Ask Corin AI (public.ai_conversations).
// The browser only ever sends a conversation id and its newest message; the
// server rebuilds history from here, so a client cannot forge assistant turns
// or rewrite what it said earlier.

export type ConversationMode = "chat" | "term_sheet";

export type StoredUserMessage = {
  role: "user";
  content: string;
  mode: ConversationMode;
  /** Validated sizer context attached to this turn, if any. */
  dealContext?: unknown;
  /** Set when restricted values (SSN, DOB, account numbers …) were masked before storage. */
  redacted?: true;
  at: string;
};

export type StoredAssistantMessage = {
  role: "assistant";
  content: string;
  stopReason: string;
  model?: string;
  /** Set when the output guardrails (lib/ai/guardrails.ts) caught something in this reply. */
  guardrail?: { mode: "enforce" | "monitor"; categories: string[]; count: number };
  /** Set when restricted values were masked before storage. */
  redacted?: true;
  at: string;
};

export type StoredMessage = StoredUserMessage | StoredAssistantMessage;

export type Conversation = {
  id: string;
  createdAt: string;
  messages: StoredMessage[];
  turnCount: number;
  /** ai_conversations.lead_id: the lead this conversation is tied to, if any. */
  leadId?: string | null;
};

export type ClaimResult = { status: "ok"; conversation: Conversation } | { status: "busy" } | { status: "not_found" };

export interface ConversationStore {
  create(meta: { ipHash: string; userAgent: string | null; page: string | null }): Promise<Conversation>;
  /** Locks the conversation for one turn so concurrent requests cannot interleave. */
  claim(id: string, lockMs: number): Promise<ClaimResult>;
  /** Appends a completed turn and releases the lock. */
  complete(id: string, expectedTurnCount: number, turn: [StoredUserMessage, StoredAssistantMessage]): Promise<void>;
  /** Releases the lock without writing (turn failed before any output). */
  release(id: string): Promise<void>;
}

/**
 * Highest classification a stored transcript may hold: the registry level of
 * ai_conversations.messages (confidential). Restricted values a visitor types
 * (SSN, DOB, account, routing and card numbers) are masked before any row is
 * written, so the plaintext never reaches Postgres or the staff review queue
 * (Global rule 8: those values may only be stored encrypted).
 */
export const TRANSCRIPT_CEILING: Classification = FIELD_CLASSIFICATION["ai_conversations.messages"]?.level ?? "confidential";

/** Returns the message as it may be stored: everything above TRANSCRIPT_CEILING masked. */
export function redactForStorage<M extends StoredMessage>(message: M): M {
  const content = redactText(message.content, TRANSCRIPT_CEILING);
  let changed = content !== message.content;
  const out = { ...message, content };
  if (out.role === "user" && out.dealContext !== undefined) {
    const before = JSON.stringify(out.dealContext);
    const dealContext = redactPayload(out.dealContext, TRANSCRIPT_CEILING);
    if (JSON.stringify(dealContext) !== before) {
      changed = true;
      out.dealContext = dealContext;
    }
  }
  return changed ? { ...out, redacted: true } : out;
}

/** Hard ceiling on user turns per conversation; the client starts a new one after this. */
export const MAX_TURNS = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { id: string; created_at: string; messages: StoredMessage[] | null; turn_count: number; lead_id?: string | null };

export class SupabaseConversationStore implements ConversationStore {
  constructor(
    private readonly db: SupabaseClient,
    private readonly now: () => number = Date.now,
  ) {}

  async create(meta: { ipHash: string; userAgent: string | null; page: string | null }): Promise<Conversation> {
    const { data, error } = await this.db
      .from("ai_conversations")
      .insert({ ip_hash: meta.ipHash, user_agent: meta.userAgent?.slice(0, 512) ?? null, page: meta.page?.slice(0, 512) ?? null })
      .select("id, created_at, messages, turn_count, lead_id")
      .single<Row>();
    if (error || !data) throw new Error(`conversation create failed: ${error?.message ?? "no row"}`);
    return toConversation(data);
  }

  async claim(id: string, lockMs: number): Promise<ClaimResult> {
    if (!UUID_RE.test(id)) return { status: "not_found" };
    const nowIso = new Date(this.now()).toISOString();
    const { data, error } = await this.db
      .from("ai_conversations")
      .update({ locked_until: new Date(this.now() + lockMs).toISOString() })
      .eq("id", id)
      .or(`locked_until.is.null,locked_until.lt."${nowIso}"`)
      .select("id, created_at, messages, turn_count, lead_id")
      .maybeSingle<Row>();
    if (error) throw new Error(`conversation claim failed: ${error.message}`);
    if (data) return { status: "ok", conversation: toConversation(data) };

    const { data: exists, error: existsError } = await this.db.from("ai_conversations").select("id").eq("id", id).maybeSingle();
    if (existsError) throw new Error(`conversation lookup failed: ${existsError.message}`);
    return exists ? { status: "busy" } : { status: "not_found" };
  }

  async complete(id: string, expectedTurnCount: number, turn: [StoredUserMessage, StoredAssistantMessage]): Promise<void> {
    const { data: current, error: readError } = await this.db
      .from("ai_conversations")
      .select("messages, turn_count")
      .eq("id", id)
      .single<Pick<Row, "messages" | "turn_count">>();
    if (readError || !current) throw new Error(`conversation read failed: ${readError?.message ?? "missing"}`);
    if (current.turn_count !== expectedTurnCount) throw new Error("conversation changed while a turn was in progress");

    const { error } = await this.db
      .from("ai_conversations")
      .update({
        // Earlier rows are re-scrubbed too, so transcripts written before redaction existed are cleaned on the next turn.
        messages: [...(current.messages ?? []), ...turn].map(redactForStorage),
        turn_count: expectedTurnCount + 1,
        last_message_at: turn[1].at,
        locked_until: null,
      })
      .eq("id", id)
      .eq("turn_count", expectedTurnCount);
    if (error) throw new Error(`conversation append failed: ${error.message}`);
  }

  async release(id: string): Promise<void> {
    const { error } = await this.db.from("ai_conversations").update({ locked_until: null }).eq("id", id);
    if (error) console.error("conversation release failed", error.message);
  }
}

function toConversation(row: Row): Conversation {
  return { id: row.id, createdAt: row.created_at, messages: row.messages ?? [], turnCount: row.turn_count, leadId: row.lead_id ?? null };
}

/** In-memory store: the test fake and the no-database fallback (per instance). */
export class MemoryConversationStore implements ConversationStore {
  readonly rows = new Map<string, Conversation & { lockedUntil: number; meta: { ipHash: string; userAgent: string | null; page: string | null } }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxRows = 5_000,
  ) {}

  async create(meta: { ipHash: string; userAgent: string | null; page: string | null }): Promise<Conversation> {
    if (this.rows.size >= this.maxRows) {
      const oldest = this.rows.keys().next().value;
      if (oldest) this.rows.delete(oldest);
    }
    const conv: Conversation = { id: randomUUID(), createdAt: new Date(this.now()).toISOString(), messages: [], turnCount: 0 };
    this.rows.set(conv.id, { ...conv, lockedUntil: 0, meta });
    return structuredClone(conv);
  }

  async claim(id: string, lockMs: number): Promise<ClaimResult> {
    const row = this.rows.get(id);
    if (!row) return { status: "not_found" };
    if (row.lockedUntil > this.now()) return { status: "busy" };
    row.lockedUntil = this.now() + lockMs;
    return { status: "ok", conversation: structuredClone({ id: row.id, createdAt: row.createdAt, messages: row.messages, turnCount: row.turnCount, leadId: row.leadId ?? null }) };
  }

  async complete(id: string, expectedTurnCount: number, turn: [StoredUserMessage, StoredAssistantMessage]): Promise<void> {
    const row = this.rows.get(id);
    if (!row) throw new Error("conversation missing");
    if (row.turnCount !== expectedTurnCount) throw new Error("conversation changed while a turn was in progress");
    row.messages = [...row.messages, ...structuredClone(turn)].map(redactForStorage);
    row.turnCount += 1;
    row.lockedUntil = 0;
  }

  async release(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.lockedUntil = 0;
  }
}

let instance: ConversationStore | undefined;

export function conversationStore(): ConversationStore {
  if (instance) return instance;
  const db = supabaseAdmin();
  if (db) {
    instance = new SupabaseConversationStore(db);
  } else {
    console.warn("conversations: Supabase not configured; Ask Corin AI history is kept in memory per instance");
    instance = new MemoryConversationStore();
  }
  return instance;
}

/** Test hook (undefined resets to the env-derived store). */
export function setConversationStore(store: ConversationStore | undefined) {
  instance = store;
}
