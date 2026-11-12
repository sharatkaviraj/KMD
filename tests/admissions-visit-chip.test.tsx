// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/*
 * A school visit booked on WhatsApp, on the Admissions board (D-593): the
 * card says when the family is coming and that the booking came from
 * WhatsApp, and a family that gave no name still has a card the office can
 * read. Synthetic data.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/app/(app)/admissions/actions", () => ({ addEnquiryAction: vi.fn(), closeEnquiryAction: vi.fn(), moveEnquiryAction: vi.fn(), undoMoveEnquiryAction: vi.fn() }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => (typeof p === "string" ? p : p.en), sub: () => null, language: "en" }) }));
vi.mock("@/vx/ui/overlays", () => ({ useToast: () => ({ show: vi.fn() }), Sheet: () => null }));

import { AdmissionsBoard, type BoardCard, type Kpis } from "@/vx/screens/admissions/board";

const kpis: Kpis = { newCount: 0, openEnquiries: 3, waitingWeek: 0, docsPending: 0, seatsLeft: null, seatsEditable: false, bands: [] };
const card = (over: Partial<BoardCard>): BoardCard => ({ id: "e1", stage: "enquiry", name: "Test Riya", classLabel: "Class 3", parent: "Test Parent", phone: "9000000001", days: 0, ...over });

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(cards: BoardCard[]) {
  await act(async () => root.render(<AdmissionsBoard sessionLabel="TEST-2026-27" kpis={kpis} cards={cards} admitted={[]} recent={[]} classLabels={["Class 3"]} />));
}

const cardOf = (text: string) => [...host.querySelectorAll<HTMLElement>("div.card")].find((element) => element.textContent?.includes(text));

it("shows when the family is coming, and that they booked on WhatsApp", async () => {
  await render([
    card({ id: "w1", name: "", visit: { when: "tomorrow", day: { en: "Fri 13 Nov", hi: "शुक्र 13 नव॰" }, part: "morning" }, fromWhatsApp: true }),
    card({ id: "w2", name: "Test Kabir", visit: { when: "passed", day: { en: "Mon 9 Nov", hi: "" }, part: "afternoon" }, fromWhatsApp: true }),
    card({ id: "w3", name: "Test Mira", visit: { when: "later", day: { en: "Mon 16 Nov", hi: "" }, part: "afternoon" }, fromWhatsApp: true }),
    card({ id: "o1", name: "Test Office" }),
  ]);
  const unnamed = cardOf("Name not given");
  expect(unnamed?.textContent).toContain("Visit tomorrow · morning");
  expect(unnamed?.textContent).toContain("WhatsApp");
  expect(unnamed?.querySelector('button[aria-label^="Name not given"]')).not.toBeNull();
  expect(cardOf("Test Kabir")?.textContent).toContain("Visit day passed · Mon 9 Nov");
  expect(cardOf("Test Mira")?.textContent).toContain("Visit Mon 16 Nov · afternoon");
  const office = cardOf("Test Office");
  expect(office?.textContent).not.toContain("WhatsApp");
  expect(office?.textContent).not.toContain("Visit");
});

it("keeps the card of an office enquiry exactly as it was", async () => {
  await render([card({ id: "o1", name: "Test Office", days: 9 })]);
  const office = cardOf("Test Office");
  expect(office?.textContent).toContain("9 days · call back");
  expect(office?.querySelectorAll(".pill")).toHaveLength(1);
});
