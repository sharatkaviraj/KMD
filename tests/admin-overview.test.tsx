// @vitest-environment jsdom
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as m from "@/messages/pairs";
import { AdminOverview } from "@/modules/home/ui/admin-overview";
import { attentionFor } from "@/modules/home/domain/attention";
import { primary, type Language } from "@/platform/i18n/language";
import { adminFixture, attentionFacts, longWorkspaces } from "./home-overview.fixture";

function render(props: Partial<React.ComponentProps<typeof AdminOverview>> = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<AdminOverview {...adminFixture} language="en" {...props} />);
  return host;
}

describe("native admin overview contracts", () => {
  for (const language of ["en", "hi", "both"] as Language[]) {
    it(`keeps every attention count, owner and destination in ${language}`, () => {
      const host = render({ language });
      for (const item of adminFixture.attention) {
        const link = host.querySelector(`[data-attention-key="${item.key}"]`)!;
        expect(link.getAttribute("href")).toBe(item.href);
        expect(link.querySelector("[data-attention-count]")!.textContent).toBe(String(item.count));
        expect(link.textContent).toContain(primary(item.label, language));
        expect(link.textContent).toContain(primary(item.owner, language));
      }
      expect(host.querySelectorAll("h1")).toHaveLength(1);
      expect(host.querySelector("h1")!.textContent).toContain(primary(m.overviewTitle, language));
    });
    it(`keeps allowed native destinations in ${language}`, () => {
      const host = render({ language });
      for (const workspace of adminFixture.workspaces) {
        const link = [...host.querySelectorAll('[aria-labelledby="admin-workspaces"] a')].find(link => link.getAttribute("href") === workspace.href);
        expect(link).toBeTruthy();
        expect(link!.textContent).toContain(primary(workspace.label, language));
      }
      for (const item of adminFixture.destinations) expect([...host.querySelectorAll("a")].some(a => a.getAttribute("href") === item.href)).toBe(true);
      expect(host.querySelector('a[href="/fees/dashboard"]')!.textContent).toContain(primary(m.overviewFeeDesk, language));
      expect(host.textContent).toContain(primary(m.overviewFeeUnavailable, language));
    });
  }
  it("places support in DOM/focus order before workspaces and the long screen list", () => {
    const host = render();
    const support = host.querySelector("[data-admin-support]")!;
    const workspaces = host.querySelector("#admin-workspaces")!;
    expect(support.compareDocumentPosition(workspaces) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(workspaces.compareDocumentPosition(host.querySelector("#admin-destinations")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("renders unread attention counts as unavailable rather than zero", () => {
    const attention = attentionFor("admin", { ...attentionFacts, unavailable: ["registers", "jobs"] }, { canMarkOnBehalf: true });
    const host = render({ attention });
    for (const key of ["registers", "jobs"]) {
      const link = host.querySelector(`[data-attention-key="${key}"]`)!;
      expect(link.querySelector("[data-attention-count]")!.textContent).toBe("-");
      expect(link.textContent).toContain(m.homeUnavailable.en);
    }
  });
  it("keeps closed-day context and gives an honest all-clear when all counts are zero", () => {
    const facts = { ...attentionFacts, schoolOpenToday: false, registersOutstanding: 0 };
    const host = render({ attention: attentionFor("admin", facts, { canMarkOnBehalf: true }) });
    expect(host.querySelector('[data-attention-key="registers"]')!.textContent).toContain(m.homeSchoolClosedToday.en);
    const clear = render({ attention: attentionFor("admin", { ...facts, absencesToday: 0, pendingSubmissions: 0, failedJobs: 0 }, { canMarkOnBehalf: true }) });
    expect(clear.textContent).toContain(m.homeAllClear.en);
    expect(clear.querySelectorAll('[data-attention-state="clear"]')).toHaveLength(4);
  });
  it("does not fabricate overview content when there is no resolved session", () => {
    const host = render({ overview: null, attention: [] });
    expect(host.querySelector("[data-admin-support]")).toBeNull();
    expect(host.textContent).not.toContain(m.overviewTodayAtSchool.en);
    expect(host.querySelector("#admin-workspaces")).not.toBeNull();
  });
  it("prioritizes unavailable and unfinished work while retaining zero owners and navigation", () => {
    const attention = attentionFor("admin", { ...attentionFacts, registersOutstanding: 0, absencesToday: 0, failedJobs: 0, unavailable: ["jobs"] }, { canMarkOnBehalf: true });
    const host = render({ attention });
    expect([...host.querySelectorAll('[data-attention-state="pending"]')].map(e => e.getAttribute("data-attention-key"))).toEqual(["review", "jobs"]);
    expect(host.querySelector('[data-attention-key="review"]')!.textContent).toContain(m.overviewReviewChanges.en);
    expect(host.querySelector('[data-attention-key="registers"]')!.textContent).toContain(m.overviewOpenRegisters.en);
    expect(host.querySelector('[data-attention-key="registers"]')!.textContent).toContain(m.homeOwnerTeachers.en);
  });
  it("collapses secondary destinations without losing allowed links", () => {
    const details = render().querySelector("details[data-all-screens]")!;
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.querySelector("summary")!.textContent).toContain(m.overviewAllScreens.en);
    expect(details.querySelectorAll("a")).toHaveLength(adminFixture.destinations.length);
    expect(details.querySelector('a[href="/timetable"]')).not.toBeNull();
    expect(details.querySelector('a[href="/staff"]')).not.toBeNull();
    expect(details.querySelector('a[href="/fees/payments"]')).not.toBeNull();
  });
  it("draws tracks only for known nonzero denominators and labels staff accurately", () => {
    const host = render();
    expect(host.querySelector('[data-overview-row="exams"] [aria-hidden]')).toBeNull();
    expect(host.querySelector('[data-overview-row="staff"]')!.textContent).toContain(m.overviewTeachingNotAway.en);
    expect(host.textContent).toContain(m.overviewTeachingBasis.en);
    const unknown = render({ overview: { ...adminFixture.overview, facts: { ...adminFixture.overview.facts, coverPublished: false, coverUnavailable: true, registersIn: null, classesTotal: null } } });
    expect(unknown.querySelector('[data-overview-row="registers"] [aria-hidden]')).toBeNull();
    expect(unknown.querySelector('[data-overview-row="cover"]')!.textContent).toContain(m.homeUnavailable.en);
    expect(unknown.textContent).not.toContain(m.overviewCoverNoPlan.en);
  });
  it("keeps every workflow inside VPPS One and retains the test-data notice", () => {
    const host = render();
    for (const link of host.querySelectorAll('[aria-labelledby="admin-workspaces"] a')) {
      expect(link.getAttribute("href")!.startsWith("/")).toBe(true);
      expect(link.getAttribute("href")!.startsWith("//")).toBe(false);
      expect(link.querySelector("[data-workspace-environment]")).toBeNull();
    }
    expect(host.textContent).toContain(m.testDataNotice.en);
    expect(host.textContent).toContain("Good morning, Test administrator");
  });
  it("distinguishes no open round, unread round and real round counts", () => {
    const overview = adminFixture.overview;
    expect(render({ overview: { ...overview, round: null } }).textContent).toContain(m.overviewRoundNone.en);
    const unread = render({ overview: { ...overview, round: null, facts: { ...overview.facts, roundUnavailable: true } } });
    expect(unread.textContent).toContain(m.homeUnavailable.en);
    expect(unread.textContent).not.toContain(m.overviewRoundNone.en);
    expect(render().querySelector('a[href="/collection/rounds/synthetic-round"]')).not.toBeNull();
  });
  it("preserves complete long workspace labels", () => {
    const host = render({ workspaces: longWorkspaces });
    expect(host.textContent).toContain(longWorkspaces[0].label.en);
    expect(host.querySelector('[aria-labelledby="admin-workspaces"] .truncate')).toBeNull();
  });
  it("uses explicit language tags for bilingual title and secondary labels", () => {
    const host = render({ language: "both" });
    expect(host.querySelector('h1 [lang="hi"]')!.textContent).toBe(m.overviewTitle.hi);
    expect(host.querySelector('h1 [lang="en"]')!.textContent).toBe(m.overviewTitle.en);
  });
});
