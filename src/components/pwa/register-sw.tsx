"use client";

import { useEffect } from "react";

/** Registers the service worker in production and clears cached pages on sign-out. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // An unsupported or blocked worker only costs offline access; the app still works.
    });

    function onSubmit(event: SubmitEvent) {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.getAttribute("action") === "/auth/signout") {
        navigator.serviceWorker.controller?.postMessage("clear-pages");
      }
    }
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
  return null;
}
