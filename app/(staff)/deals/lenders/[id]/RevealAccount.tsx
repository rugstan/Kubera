"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { revealLenderAccountAction, type RevealAccountState } from "../../actions";

// Shows one lender account number on request (admins and the designated
// officer). The server action audits the reveal before decrypting and returns
// the value only in its state; this component keeps it in memory, masks it
// again after 30 seconds or on Hide (and on unmount, when the page changes),
// and never writes it to storage, the URL or the console. Props are plain
// strings: never ciphertext or records.
//
// Keyboard and screen readers: the live regions are always in the DOM (empty
// while masked), so filling them is announced. A reveal moves focus to Hide;
// Hide, or the re-mask while focus is on Hide or Copy, moves it back to Reveal.

const REMASK_MS = 30_000;

export function RevealAccount(props: { lenderId: string; accountId: string; label: string; masked: string }) {
  const { lenderId, accountId, label } = props;
  const [state, action, pending] = useActionState<RevealAccountState, FormData>(revealLenderAccountAction, {});
  // The reveal (by nonce) the user hid or that timed out, and the one they copied.
  const [hiddenNonce, setHiddenNonce] = useState<number | null>(null);
  const [copiedNonce, setCopiedNonce] = useState<number | null>(null);
  const nonce = state.nonce ?? null;
  const shown = state.value && nonce !== null && nonce !== hiddenNonce ? state.value : null;

  const rootRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLButtonElement>(null);
  const hideRef = useRef<HTMLButtonElement>(null);
  // Set when masking removes the focused Hide or Copy button.
  const refocusReveal = useRef(false);

  const mask = useCallback((n: number | null) => {
    refocusReveal.current = Boolean(rootRef.current?.contains(document.activeElement));
    setHiddenNonce(n);
  }, []);

  useEffect(() => {
    if (nonce === null) return;
    const timer = setTimeout(() => mask(nonce), REMASK_MS);
    return () => clearTimeout(timer);
  }, [nonce, mask]);

  useEffect(() => {
    if (shown) {
      hideRef.current?.focus();
    } else if (refocusReveal.current) {
      refocusReveal.current = false;
      revealRef.current?.focus();
    }
  }, [shown]);

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
    <div className="mt-1 flex flex-wrap items-center gap-2" ref={rootRef}>
      <output aria-live="polite" className={shown ? "basis-full font-mono text-sm break-all" : "sr-only"}>
        {shown ?? ""}
      </output>
      {shown ? (
        <>
          <button aria-label={`Hide ${label}`} className="pill pill-glass min-h-11" onClick={() => mask(nonce)} ref={hideRef} type="button">
            Hide
          </button>
          <button aria-label={`Copy ${label}`} className="pill pill-glass min-h-11" onClick={copy} type="button">
            Copy
          </button>
        </>
      ) : (
        <form action={action}>
          <input name="lenderId" type="hidden" value={lenderId} />
          <input name="accountId" type="hidden" value={accountId} />
          <button aria-label={`Reveal ${label}`} className="pill pill-glass min-h-11" disabled={pending} ref={revealRef} type="submit">
            {pending ? "Revealing…" : "Reveal"}
          </button>
        </form>
      )}
      <span className="text-xs text-titanium" role="status">
        {shown && copiedNonce !== null && copiedNonce === nonce ? "Copied" : ""}
      </span>
      {state.error ? (
        <p className="w-full text-sm text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
