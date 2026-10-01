"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { performanceNames, performanceRoute, type PerformanceEvent } from "@/platform/performance/policy";
import { recordPerformance } from "@/platform/performance/record";

function vital(metric: { name: string; value: number }) {
  if (performanceNames.includes(metric.name as PerformanceEvent["name"])) recordPerformance(metric.name as PerformanceEvent["name"], metric.value);
}

/** Sample 10% of workspace visits; send bounded anonymous measurements to logs. */
export function PerformanceReporter() {
  useReportWebVitals(vital);
  useEffect(() => {
    const sampled = Math.random() < 0.1;
    const events: PerformanceEvent[] = [];
    const flush = () => {
      if (!events.length) return;
      const body = JSON.stringify(events.splice(0, 20));
      void fetch("/api/performance", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
    };
    const collect = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const value = detail?.value ?? detail?.durationMs;
      if (!sampled || !performanceNames.includes(detail?.name) || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 60000) return;
      events.push({ name: detail.name, value: Math.round(value * 1000) / 1000, route: performanceRoute(window.location.pathname), device: window.innerWidth < 768 ? "phone" : window.innerWidth < 1024 ? "tablet" : "desktop", installed: window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone) });
      if (events.length >= 20) flush();
    };
    const hidden = () => { if (document.hidden) flush(); };
    window.addEventListener("vpps:performance", collect);
    window.addEventListener("vpps:office-metric", collect);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    const timer = window.setInterval(flush, 15000);
    return () => {
      flush(); window.clearInterval(timer);
      window.removeEventListener("vpps:performance", collect);
      window.removeEventListener("vpps:office-metric", collect);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  return null;
}
