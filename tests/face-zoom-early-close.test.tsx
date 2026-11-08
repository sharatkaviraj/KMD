// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { openFaceZoom } from "@/vx/ui/face-zoom";

/*
 * The open photo (D-554) listens for Escape and Back from the moment it is on
 * screen. Its listeners once sat in a passive effect, which React may run a
 * frame later; on CI's slower machine an Escape pressed in between was lost
 * and the photo stayed open (8 Nov 2026).
 */

it("Escape pressed the moment the open photo appears closes it", async () => {
  const from = document.createElement("span");
  document.body.append(from);
  const pressed = new Promise<void>((done) => {
    const watch = new MutationObserver(() => {
      if (!document.querySelector(".vx-face-zoom")) return;
      watch.disconnect();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      done();
    });
    watch.observe(document.body, { childList: true, subtree: true });
  });
  openFaceZoom({ from, thumb: "/api/photos/students/x?v=1&d=1&s=list&t=x", name: "QA Child", language: "en" });
  await pressed;
  await vi.waitFor(() => expect(document.querySelector(".vx-face-zoom")).toBeNull(), { timeout: 2000 });
});
