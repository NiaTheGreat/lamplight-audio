"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/client/offline";

/** Registers the service worker that plays chapters kept for offline listening. Renders nothing. */
export function OfflineRegistrar() {
  useEffect(() => registerServiceWorker(), []);
  return null;
}
