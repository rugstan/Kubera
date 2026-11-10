"use client";

import { useActionState, useEffect, useState } from "react";
import { revealLenderAccountAction, type RevealAccountState } from "../../actions";

// Shows one lender account number on request (admins and the designated
// officer). The server action audits the reveal before decrypting and returns
// the value only in its state; this component keeps it in memory, masks it
// again after 30 seconds or on Hide (and on unmount, when the page changes),
// and never writes it to storage, the URL or the console. Props are plain
// strings: never ciphertext or records.

const REMASK_MS = 30_000;

export function RevealAccount(props: { lenderId: string; accountId: string; label: string; masked: string }) {
  const { lenderId, accountId, label } = props;
  const [state, action, pending] = useActionState<RevealAccountState, FormData>(revealLenderAccountAction, {});
  // The reveal (by nonce) the user hid or that timed out, and the one they copied.
  const [hiddenNonce, setHiddenNonce] = useState<number | null>(null);
  const [copiedNonce, setCopiedNonce] = useState<number | null>(null);
  const nonce = state.nonce ?? null;
  const shown = state.value && nonce !== null && nonce !== hiddenNonce ? state.value : null;

  useEffect(() => {
    if (nonce === null) return;
    const timer = setTimeout(() => setHiddenNonce(nonce), REMASK_MS);
    return () => clearTimeout(timer);
  }, [nonce]);

  const copy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown);
      setCopiedNonce(nonce);
    } catch {
      setCopiedNonce(null);
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {shown ? (
        <>
          <output aria-live="polite" className="font-mono text-sm break-all">
            {shown}
          </output>
          <button className="pill pill-glass min-h-11" onClick={() => setHiddenNonce(nonce)} type="button">
            Hide
          </button>
          <button className="pill pill-glass min-h-11" onClick={copy} type="button">
            Copy
          </button>
          {copiedNonce !== null && copiedNonce === nonce ? (
            <span className="text-xs text-titanium" role="status">
              Copied
            </span>
          ) : null}
        </>
      ) : (
        <form action={action}>
          <input name="lenderId" type="hidden" value={lenderId} />
          <input name="accountId" type="hidden" value={accountId} />
          <button aria-label={`Reveal ${label}`} className="pill pill-glass min-h-11" disabled={pending} type="submit">
            {pending ? "Revealing…" : "Reveal"}
          </button>
        </form>
      )}
      {state.error ? (
        <p className="w-full text-sm text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
