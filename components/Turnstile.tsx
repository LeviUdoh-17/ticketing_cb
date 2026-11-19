"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

// Keep in sync with TURNSTILE_ACTION in lib/turnstile.ts.
const ACTION = "create-ticket";

export type TurnstileStatus = "pending" | "ready" | "error";

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Cloudflare Turnstile widget. Must sit inside the <form>: it adds a hidden
 * `cf-turnstile-response` input that the Server Action verifies. Each mount
 * renders a fresh widget, so the form's remount after a failed submit also
 * gets a fresh (single-use) token. Reports progress through onStatus so the
 * form can hold the submit button until a token exists.
 */
export function Turnstile({
  siteKey,
  onStatus,
}: {
  siteKey: string;
  onStatus: (status: TurnstileStatus, errorCode?: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Latest callback without re-rendering the widget when the parent re-renders.
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  });

  const render = useCallback(() => {
    if (!container.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      action: ACTION,
      "response-field-name": "cf-turnstile-response",
      appearance: "interaction-only",
      theme: "light",
      "refresh-expired": "auto",
      callback: () => onStatusRef.current("ready"),
      "expired-callback": () => onStatusRef.current("pending"),
      "timeout-callback": () => onStatusRef.current("pending"),
      "error-callback": (code: string) => {
        // Codes: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
        // 110200 = this hostname isn't allowed for the site key.
        console.error(`[turnstile] error ${code}`);
        onStatusRef.current("error", String(code));
      },
    });
  }, [siteKey]);

  useEffect(() => {
    onStatusRef.current("pending");
    render(); // script may already be loaded (e.g. on remount)
    return () => {
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [render]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={render}
        onError={() => {
          console.error("[turnstile] script failed to load (blocked by an extension or network?)");
          onStatusRef.current("error", "script-blocked");
        }}
      />
      <div ref={container} />
    </>
  );
}
