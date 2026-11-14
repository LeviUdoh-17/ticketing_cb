"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

// Keep in sync with TURNSTILE_ACTION in lib/turnstile.ts.
const ACTION = "create-ticket";

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
 * gets a fresh (single-use) token.
 */
export function Turnstile({ siteKey }: { siteKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const render = useCallback(() => {
    if (!container.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      action: ACTION,
      "response-field-name": "cf-turnstile-response",
      appearance: "interaction-only",
      theme: "light",
    });
  }, [siteKey]);

  useEffect(() => {
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
      />
      <div ref={container} />
    </>
  );
}
