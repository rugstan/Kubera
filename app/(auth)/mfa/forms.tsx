"use client";

import { useActionState, useEffect, useRef } from "react";
import { startEnrollmentAction, verifyMfaAction, type EnrollState, type MfaState } from "../actions";
import { PendingButton } from "../pending-button";

function CodeForm({ factorId, next, label }: { factorId: string; next: string; label: string }) {
  const [state, action] = useActionState<MfaState, FormData>(verifyMfaAction, {});
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.error) input.current?.focus();
  }, [state]);
  return (
    <form action={action} className="mt-5 grid gap-4">
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="totp" className="field-label">
          {label}
        </label>
        <input
          ref={input}
          id="totp"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className="field tracking-[0.3em]"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "totp-error" : undefined}
        />
        {state.error ? (
          <p id="totp-error" role="alert" className="mt-1.5 text-[13px] text-red-800">
            {state.error}
          </p>
        ) : null}
      </div>
      <PendingButton>Verify</PendingButton>
    </form>
  );
}

export function MfaChallenge({ factorId, next }: { factorId: string; next: string }) {
  return (
    <>
      <p className="mt-2 text-[15px] leading-relaxed text-titanium">Open your authenticator app and enter the current code for Kubera Commercial.</p>
      <CodeForm factorId={factorId} next={next} label="Authenticator code" />
    </>
  );
}

export function MfaEnroll({ next }: { next: string }) {
  const [state, start] = useActionState<EnrollState, FormData>(async () => startEnrollmentAction(), { status: "idle" });

  if (state.status !== "enrolling") {
    return (
      <form action={start} className="mt-4 grid gap-4">
        <p className="text-[15px] leading-relaxed text-titanium">
          Set up an authenticator app (1Password, Google Authenticator, Microsoft Authenticator or similar) once. You will enter its code each time you sign in.
        </p>
        {state.status === "error" ? (
          <p role="alert" className="rounded-xl border border-red-700/30 bg-red-50 px-4 py-3 text-[14px] text-red-800">
            {state.message}
          </p>
        ) : null}
        <PendingButton>Set up authenticator</PendingButton>
      </form>
    );
  }

  return (
    <div className="mt-4">
      <ol className="grid list-decimal gap-3 pl-5 text-[15px] leading-relaxed text-titanium">
        <li>Scan the QR code with your authenticator app, or enter the key by hand.</li>
        <li>Enter the 6-digit code the app shows to finish.</li>
      </ol>
      {state.qrCode ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL from the identity provider
        <img src={state.qrCode} alt="QR code for your authenticator app" width={180} height={180} className="mx-auto mt-5 rounded-xl border border-hairline bg-white p-2" />
      ) : null}
      <div className="mt-5 rounded-xl bg-canvas p-4">
        <p className="field-label">Setup key</p>
        <code className="block break-all text-[15px] font-medium tracking-wider text-ink" data-testid="totp-secret">
          {state.secret}
        </code>
        <a href={state.uri} className="mt-2 inline-block text-[14px] text-accent underline underline-offset-2">
          Open in an authenticator app on this device
        </a>
      </div>
      <CodeForm factorId={state.factorId} next={next} label="Code from your app" />
    </div>
  );
}
