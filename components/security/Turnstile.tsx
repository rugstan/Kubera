"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { TURNSTILE_HEADER, type TurnstileAction } from "@/lib/turnstile/types";

// Cloudflare Turnstile, rendered explicitly in "execute" mode: the widget stays
// invisible unless Cloudflare needs an interaction, and every call to
// getToken() mints a fresh single-use token for one API request.
//
// Usage in a form:
//   const turnstile = useTurnstile("qualify");
//   ...
//   <TurnstileSlot turnstile={turnstile} />
//   const token = await turnstile.getToken();
//   fetch("/api/qualify", { headers: { "content-type": "application/json", ...turnstileHeaders(token) }, ... })
//
// With NEXT_PUBLIC_TURNSTILE_SITE_KEY unset, getToken() resolves null and the
// server skips verification (it is only enforced when TURNSTILE_SECRET_KEY is set).

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_TIMEOUT_MS = 30_000;
export const TURNSTILE_ENABLED = Boolean(SITE_KEY);

type RenderOptions = {
  sitekey: string;
  action?: string;
  execution?: "render" | "execute";
  appearance?: "always" | "execute" | "interaction-only";
  size?: "normal" | "flexible" | "compact";
  callback?: (token: string) => void;
  "error-callback"?: (code: string) => boolean | void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
};

type TurnstileApi = {
  render(container: HTMLElement, options: RenderOptions): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile failed to initialize")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type TurnstileHandle = {
  enabled: boolean;
  /** Fresh token for one request, or null when Turnstile is off or could not run. */
  getToken(): Promise<string | null>;
  /** Callback ref for the element Cloudflare renders into (see TurnstileSlot). */
  attach: (el: HTMLDivElement | null) => void;
};

export function useTurnstile(action: TurnstileAction): TurnstileHandle {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
  }, []);
  const widgetRef = useRef<string | null>(null);
  const pendingRef = useRef<((token: string | null) => void) | null>(null);

  const settle = useCallback((token: string | null) => {
    const resolve = pendingRef.current;
    pendingRef.current = null;
    resolve?.(token);
  }, []);

  useEffect(
    () => () => {
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
      settle(null);
    },
    [settle],
  );

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!SITE_KEY || !containerRef.current) return null;
    let api: TurnstileApi;
    try {
      api = await loadTurnstile();
    } catch {
      return null;
    }
    settle(null);
    if (!widgetRef.current) {
      widgetRef.current = api.render(containerRef.current, {
        sitekey: SITE_KEY,
        action,
        execution: "execute",
        appearance: "interaction-only",
        size: "flexible",
        callback: (token) => settle(token),
        "error-callback": () => {
          settle(null);
          return true;
        },
        "expired-callback": () => settle(null),
        "timeout-callback": () => settle(null),
      });
    } else {
      api.reset(widgetRef.current);
    }
    const widgetId = widgetRef.current;
    return new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => settle(null), TOKEN_TIMEOUT_MS);
      pendingRef.current = (token) => {
        window.clearTimeout(timer);
        resolve(token);
      };
      api.execute(widgetId);
    });
  }, [action, settle]);

  return useMemo(() => ({ enabled: TURNSTILE_ENABLED, getToken, attach }), [getToken, attach]);
}

/** Where Cloudflare draws its challenge when one is needed. Renders nothing visible otherwise. */
export function TurnstileSlot({ turnstile: { attach }, className }: { turnstile: TurnstileHandle; className?: string }) {
  if (!TURNSTILE_ENABLED) return null;
  return <div ref={attach} className={className} />;
}

export function turnstileHeaders(token: string | null): Record<string, string> {
  return token ? { [TURNSTILE_HEADER]: token } : {};
}
