"use client";
import { useSyncExternalStore } from "react";
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type PwaState = { installed: boolean; installable: boolean; ios: boolean; ready: boolean; waiting: boolean };
const initial: PwaState = { installed: false, installable: false, ios: false, ready: false, waiting: false };
let state = initial;
let promptEvent: InstallEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let candidate: ServiceWorker | null = null;
const listeners = new Set<() => void>();
export function updatePwa(next: Partial<PwaState>) {
  state = { ...state, ...next };
  listeners.forEach(listener => listener());
}
export function usePwaState() {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => state, () => initial);
}
export function registerPwa(next: ServiceWorkerRegistration, installed?: ServiceWorker) {
  registration = next;
  candidate = installed ?? next.waiting;
  updatePwa({ ready: true, waiting: Boolean(candidate) });
}
export function waitingWorker() { return registration?.waiting ?? candidate; }
export function captureInstall(event: Event) { event.preventDefault(); promptEvent = event as InstallEvent; updatePwa({ installable: true }); }
export async function installPwa() {
  const event = promptEvent;
  if (!event) return;
  promptEvent = null;
  updatePwa({ installable: false });
  await event.prompt();
  await event.userChoice;
  // appinstalled / display-mode confirms installation, not prompt acceptance.
}
