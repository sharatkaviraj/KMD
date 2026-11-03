/** Keep an editing password at its visible position while the IME reacts to a
 * type change. Android can pan only visualViewport, leaving scrollY unchanged.
 * Listeners exist for this toggle only and yield to navigation or scrolling. */
export function preservePasswordViewport(input: HTMLInputElement, visibleTop: number) {
  const viewport = window.visualViewport;
  if (!viewport) return;

  let frame = 0;
  let stopped = false;
  let timer = 0;
  const interrupts = ["pointerdown", "touchmove", "wheel"] as const;

  function stop() {
    if (stopped) return;
    stopped = true;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    viewport!.removeEventListener("scroll", schedule);
    viewport!.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("keydown", navigate, true);
    input.removeEventListener("blur", stop);
    for (const event of interrupts) window.removeEventListener(event, stop, true);
  }

  function navigate(event: KeyboardEvent) {
    if (["Tab", "Escape", "PageUp", "PageDown"].includes(event.key)) stop();
  }

  function restore() {
    frame = 0;
    if (!input.isConnected || document.activeElement !== input) { stop(); return; }
    const rect = input.getBoundingClientRect();
    // If the keyboard becomes taller, move only enough to keep the whole field
    // visible. Otherwise retain its position in the visual viewport exactly.
    const target = Math.max(0, Math.min(visibleTop, viewport!.height - rect.height));
    const delta = rect.top - viewport!.offsetTop - target;
    if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: "instant" });
  }

  function schedule() {
    if (!stopped && !frame) frame = window.requestAnimationFrame(restore);
  }

  viewport.addEventListener("scroll", schedule, { passive: true });
  viewport.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("keydown", navigate, true);
  input.addEventListener("blur", stop);
  for (const event of interrupts) window.addEventListener(event, stop, { capture: true, passive: true });
  // The measured S24 pan finished within 200ms; cover the IME animation without
  // keeping a scroll handler alive for the editing session.
  timer = window.setTimeout(stop, 500);
  schedule();
  return stop;
}
