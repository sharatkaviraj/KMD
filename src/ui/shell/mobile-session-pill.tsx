"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  listAvailableSessionsAction,
  setViewSessionAction,
} from "@/app/(app)/fees/session/actions";
import { releaseAllSheetScrollLocks, Sheet } from "@/ui/primitives/sheet";
import type { AvailableSessionRow } from "@/modules/fees/platform/session-context/available-sessions";
import { useSessionSwitching } from "@/modules/fees/platform/session-context/switching-context";
import { toast } from "@/ui/primitives/toast";
import { cn } from "@/platform/utils";

import {
  buildSessionSwitchHref,
  groupSessions,
  isTestSession,
  normalizeSessionLabel,
  sessionSyncGuard,
  sessionThisViewerMayOpen,
} from "./session-pill";

const EMPTY_SESSIONS: AvailableSessionRow[] = [];

type MobileSessionPillProps = {
  currentLabel: string;
  isTest: boolean;
  initialSessions?: AvailableSessionRow[];
};

export function MobileSessionPill({
  currentLabel,
  isTest,
  initialSessions = EMPTY_SESSIONS,
}: MobileSessionPillProps) {
  const t = useTranslations("MobileApp");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prefetchTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<AvailableSessionRow[]>(initialSessions);
  const [isLoading, setIsLoading] = useState(initialSessions.length === 0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isRefreshing, startNavTransition] = useTransition();
  const { setIsSwitching: setGlobalSessionSwitching } = useSessionSwitching();
  // A `?session=` this viewer may not open is ignored by the server (Phase 3:
  // a test account asking for 2026-27 is shown TEST-2026-27). The pill must
  // not print it either, or a test account reads "2026-27" over TEST data. So
  // the URL only wins once the viewer's own session list says it may.
  const urlSession = sessionThisViewerMayOpen(normalizeSessionLabel(searchParams.get("session")), sessions);
  const [optimisticLabel, setOptimisticLabel] = useState<string | null>(null);
  const displayLabel = optimisticLabel ?? urlSession ?? currentLabel;
  const displayIsTest =
    optimisticLabel || urlSession ? isTestSession(optimisticLabel ?? urlSession ?? "") : isTest;
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const isTransitioning = isSwitching || isRefreshing;

  useEffect(() => {
    if (initialSessions.length > 0) {
      setSessions(initialSessions);
      setIsLoading(false);
      setLoadFailed(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setLoadFailed(false);

    listAvailableSessionsAction()
      .then((rows) => {
        if (isMounted) {
          setSessions(rows);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSessions(initialSessions);
          setIsLoading(false);
          setLoadFailed(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [initialSessions, loadAttempt]);

  useEffect(() => {
    setOptimisticLabel(null);
  }, [currentLabel, urlSession]);

  // Ref-guarded so it cannot loop — see the long note on the same effect in
  // session-pill.tsx. `currentLabel` comes from a cookie-only layout resolve
  // and can lag the URL indefinitely, so "have I already synced THIS label" is
  // the only exit condition that reliably terminates.
  useEffect(() => {
    if (!urlSession || urlSession === currentLabel) return;
    if (sessionSyncGuard.label === urlSession) return;

    sessionSyncGuard.label = urlSession;

    void (async () => {
      try {
        // No router.refresh() — see the note on the same effect in
        // session-pill.tsx. The action's own revalidation is enough, and the
        // extra refresh was the second navigation that snapped the URL back.
        await setViewSessionAction(urlSession);
      } catch (err) {
        sessionSyncGuard.label = null;
        console.error("Failed to sync session from URL to cookie", err);
      }
    })();
  }, [urlSession, currentLabel]);

  useEffect(() => {
    setGlobalSessionSwitching(isTransitioning);

    return () => {
      setGlobalSessionSwitching(false);
    };
  }, [isTransitioning, setGlobalSessionSwitching]);

  useEffect(() => {
    return () => {
      if (prefetchTimerRef.current !== null) {
        window.clearTimeout(prefetchTimerRef.current);
      }
    };
  }, []);

  function clearPrefetchTimer() {
    if (prefetchTimerRef.current !== null) {
      window.clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  }

  function prefetchSession(label: string) {
    clearPrefetchTimer();
    const targetHref = buildSessionSwitchHref(pathname, searchParams, label);

    prefetchTimerRef.current = window.setTimeout(() => {
      router.prefetch(targetHref);
      prefetchTimerRef.current = null;
    }, 100);
  }

  function selectSession(label: string) {
    clearPrefetchTimer();
    const targetHref = buildSessionSwitchHref(pathname, searchParams, label);

    setOptimisticLabel(label);
    setIsSwitching(true);
    setOpen(false);
    releaseAllSheetScrollLocks();
    // Warm the destination while the cookie write is in flight.
    router.prefetch(targetHref);

    // We write the cookie ourselves below; stop the sync effect duplicating it.
    sessionSyncGuard.label = label;

    void (async () => {
      try {
        // Cookie FIRST, then navigate — see the same comment in session-pill.
        // The page honours `?session=`, the layout can only read the cookie,
        // so navigating before the write lands renders chrome and data from
        // two different sessions.
        const result = await setViewSessionAction(label);

        if (result.success) {
          const confirmedHref = buildSessionSwitchHref(pathname, searchParams, result.sessionLabel);
          sessionSyncGuard.label = result.sessionLabel;
          startNavTransition(() => {
            router.replace(confirmedHref, { scroll: false });
          });
        } else {
          // Same rule as the desktop pill: a silent revert reads as the pill
          // ignoring the tap.
          sessionSyncGuard.label = null;
          setOptimisticLabel(null);
          toast({
            title: t("sessionSwitchFailed"),
            description: t("sessionSwitchFailedDescription", { label, currentLabel }),
            tone: "danger",
          });
        }
      } catch {
        sessionSyncGuard.label = null;
        setOptimisticLabel(null);
        toast({
          title: t("sessionSwitchFailed"),
          description: t("sessionSwitchFailedDescription", { label, currentLabel }),
          tone: "danger",
        });
      } finally {
        // Cleared here rather than synchronously after startNavTransition:
        // React batches a set(true)/set(false) pair in one handler, so the old
        // ordering meant isSwitching was never observably true.
        setIsSwitching(false);
        setGlobalSessionSwitching(false);
        releaseAllSheetScrollLocks();
      }
    })();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "focus-ring grid min-h-11 w-[min(42vw,10rem)] min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_1rem] items-center gap-2 rounded-full border bg-surface px-3 py-2 text-center text-sm font-semibold leading-5 text-foreground",
          "transition-[background-color,border-color,transform,opacity] duration-150 motion-safe:active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none",
          displayIsTest
            ? "border-fuchsia-500 text-fuchsia-700 dark:border-fuchsia-400 dark:text-fuchsia-300"
            : "border-border hover:bg-surface-2",
          isTransitioning && "opacity-75",
        )}
        aria-label={t("sessionChangeAria", { label: displayLabel })}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={isTransitioning}
        aria-busy={isTransitioning}
      >
        {/* A long label (`TEST-2026-27`) is set a size smaller so it stays on
            one line at 375px instead of breaking at its hyphen; it still wraps,
            never truncates, if a longer one ever comes (One-only, Phase C). */}
        <span
          className={cn(
            "min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]",
            displayLabel.length > 9 && "text-xs tracking-tight",
          )}
        >
          {displayLabel}
        </span>
        <span className="grid size-4 place-items-center" aria-hidden="true">
          {isTransitioning ? (
            <Loader2 className="size-4 motion-safe:animate-spin" />
          ) : (
            <ChevronDown className={cn(
              "size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-180",
            )} />
          )}
        </span>
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("sessionTitle")}
        closeLabel={tCommon("close")}
        description={t("sessionDescription")}
        className="h-[100dvh] max-h-[100dvh] rounded-none"
      >
        <div className="mx-auto w-full max-w-xl space-y-6 pb-4">
          {isTransitioning ? (
            <p className="rounded-md border border-border bg-surface-2 px-3 py-2 break-words text-sm font-medium leading-6 text-muted-foreground">
              {t("sessionChanging", { label: displayLabel })}
            </p>
          ) : null}
          {isLoading || loadFailed || groups.length === 0 ? (
            <div className="space-y-3 rounded-md border border-dashed border-border bg-surface-2 px-3 py-3 break-words text-sm leading-6 text-muted-foreground">
              <p role={loadFailed ? "alert" : "status"}>
                {isLoading ? t("sessionsLoading") : loadFailed ? t("sessionsLoadFailed") : t("sessionsEmpty")}
              </p>
              {loadFailed ? (
                <button type="button" className="focus-ring min-h-11 rounded-lg border border-border bg-card px-4 font-semibold text-foreground" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
                  {t("sessionsRetry")}
                </button>
              ) : null}
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.title} className="min-w-0 space-y-2">
                <p className="break-words text-xs font-semibold leading-5 tracking-wide text-muted-foreground">
                  {t(group.title === "Active" ? "sessionGroupActive" : group.title === "Other production" ? "sessionGroupOther" : "sessionGroupTest")}
                </p>
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {group.rows.map((session) => {
                    const selected = session.session_label === displayLabel;
                    const rowIsTest = isTestSession(session.session_label);

                    return (
                      <button
                        key={session.id}
                        type="button"
                        disabled={isTransitioning || selected}
                        aria-pressed={selected}
                        onClick={() => selectSession(session.session_label)}
                        onFocus={() => prefetchSession(session.session_label)}
                        onMouseEnter={() => prefetchSession(session.session_label)}
                        className={cn(
                          "focus-ring grid min-h-14 w-full min-w-0 grid-cols-[minmax(0,1fr)_1.25rem] items-center gap-3 px-4 py-3 text-left text-sm leading-6 hover:bg-surface-2 disabled:opacity-60",
                          "transition-colors duration-150 motion-safe:active:translate-y-px motion-reduce:transform-none motion-reduce:transition-none",
                          selected && "bg-accent-soft font-semibold disabled:opacity-100",
                        )}
                      >
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{session.session_label}</span>
                          {rowIsTest ? (
                            <span className="max-w-full break-words rounded-full border border-fuchsia-300 px-2 py-0.5 text-xs font-semibold leading-5 text-fuchsia-700 dark:border-fuchsia-500 dark:text-fuchsia-300">
                              {t("sessionTestBadge")}
                            </span>
                          ) : null}
                        </span>
                        <span className="grid size-5 place-items-center" aria-hidden="true">
                          {selected ? <Check className="anim-settle-in size-5" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </Sheet>
    </>
  );
}
