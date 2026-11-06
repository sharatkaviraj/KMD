import { requirePermission } from "@/platform/auth/current-staff";
import { loadRollChildren } from "@/modules/students-fees/vx/admissions";
import { loadLinkedFamilies } from "@/modules/students-fees/vx/families";
import { IMPORT_FIELDS, loadImportBatch, suggestedMapping } from "@/modules/imports/vx/flow";
import { loadPromotionBoard } from "@/modules/promotion/vx/promote";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { dayMonth, schoolToday } from "@/vx/format";
import { lead, p, type Pair } from "@/vx/text";
import { VxPage, TopBar } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";

import { groupFamilies } from "@/vx/screens/admissions/logic";
import { listBulkChanges, loadPromotionMarks, loadQualitySkips } from "@/vx/screens/student-tools/data";
import { FamiliesView, type FamKid } from "@/vx/screens/student-tools/families";
import { ToolsHub, type HubTool } from "@/vx/screens/student-tools/hub";
import { ImportFlow, type ImportProps } from "@/vx/screens/student-tools/import";
import { findQualityIssues, qualityScore, suggestFamilies, suggestNextClass } from "@/vx/screens/student-tools/logic";
import { PromoteFlow } from "@/vx/screens/student-tools/promote";
import { QualityList } from "@/vx/screens/student-tools/quality";

export const runtime = "nodejs";

const VIEWS = ["hub", "promote", "promote-review", "promoted", "import", "mapping", "validate", "imported", "quality", "families", "merge"] as const;
type View = (typeof VIEWS)[number];

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** The session this viewer is on — TEST-2026-27 for a test account, never the live year it may not read. */
async function viewSessionLabel(): Promise<string> {
  return (await resolveViewSession({ cookieSession: await getViewSessionCookie() })).sessionLabel;
}

type Lang = Parameters<typeof lead>[1];
const TOOLS = p("Promote & import", "प्रमोशन व इम्पोर्ट");

/** Promote & import (design `StudentTools`): promote, import, data quality and families. */
export default async function StudentToolsPage(props: PageProps<"/student-tools">) {
  await requirePermission("fees:manage", "/student-tools");
  const params = await props.searchParams;
  const raw = one(params.view);
  const view: View = (VIEWS as readonly string[]).includes(raw) ? (raw as View) : "hub";
  const { staff } = await getViewer();
  const lang = staff.language;

  if (view === "promote" || view === "promote-review" || view === "promoted") return <VxPage>{await promoteBody(view)}</VxPage>;

  let top: { crumb: string; title: string; mSub?: string; back?: { href: string; label: Pair } };
  let body: React.ReactNode;
  if (view === "import" || view === "mapping" || view === "validate" || view === "imported") {
    const r = await importBody(view, one(params.batch) || null);
    body = r.body;
    const step = { import: 1, mapping: 2, validate: 3, imported: 3 }[r.stage];
    const titles: Record<typeof r.stage, Pair> = { import: p("Import from Excel", "Excel से इम्पोर्ट"), mapping: p("Match the columns", "कॉलम मिलाएँ"), validate: p("Check the rows", "पंक्तियाँ जाँचें"), imported: p("Import done", "इम्पोर्ट हो गया") };
    top = {
      crumb: `${lead(TOOLS, lang)} · ${lead(p("Import", "इम्पोर्ट"), lang)}`,
      title: lead(titles[r.stage], lang),
      mSub: `${lead(p("Step", "चरण"), lang)} ${step} ${lead(p("of", "/"), lang)} 3${r.filename ? ` · ${r.filename}` : ""}`,
      back: r.stage === "validate" && r.batchId ? { href: `/student-tools?view=mapping&batch=${r.batchId}`, label: p("Back to columns", "कॉलम पर लौटें") } : { href: "/student-tools", label: p("Back to tools", "टूल्स पर लौटें") },
    };
  } else if (view === "quality") {
    const r = await qualityBody();
    body = r.body;
    top = { crumb: lead(TOOLS, lang), title: lead(p("Data quality", "डेटा की जाँच"), lang), mSub: lead(p(`${r.count} things to fix`, `${r.count} चीज़ें सुधारनी हैं`), lang), back: { href: "/student-tools", label: p("Back to tools", "टूल्स पर लौटें") } };
  } else if (view === "families" || view === "merge") {
    const r = await familiesBody(one(params.merge) || null);
    body = r.body;
    top = { crumb: lead(TOOLS, lang), title: lead(p("Families", "परिवार"), lang), mSub: lead(p(`${r.families} families · ${r.withSiblings} with siblings`, `${r.families} परिवार · ${r.withSiblings} में भाई-बहन`), lang), back: { href: "/student-tools", label: p("Back to tools", "टूल्स पर लौटें") } };
  } else {
    const r = await hubBody(lang);
    body = r.body;
    top = { crumb: `${lead(p("Students", "विद्यार्थी"), lang)} · ${lead(p("Session", "सत्र"), lang)} ${r.sessionLabel}`, title: lead(TOOLS, lang), mSub: lead(p(`4 tools · ${r.toFix} things to fix`, `4 टूल · ${r.toFix} चीज़ें सुधारनी हैं`), lang) };
  }

  return (
    <VxPage>
      <TopBar
        crumb={top.crumb}
        title={top.title}
        mSub={top.mSub}
        mBack={view === "hub" ? "/menu" : (top.back?.href ?? "/student-tools")}
        actions={top.back ? <Btn variant="ghost" icon="chevLeft" href={top.back.href}>{lead(top.back.label, lang)}</Btn> : undefined}
      />
      <main>{body}</main>
    </VxPage>
  );
}

async function hubBody(lang: Lang) {
  const sessionLabel = await viewSessionLabel();
  const [changes, board, imports, children, skipped] = await Promise.all([
    listBulkChanges(8),
    loadPromotionBoard().catch(() => null),
    loadImportBatch(null).catch(() => ({ batch: null, recent: [] })),
    loadRollChildren(sessionLabel),
    loadQualitySkips(schoolToday()),
  ]);
  const hits = findQualityIssues(children, sessionLabel, skipped);
  const score = qualityScore(children.length, hits);
  const families = groupFamilies(children);
  const withSiblings = families.filter((f) => f.kids.length >= 2).length;
  const last = imports.recent[0];
  const applied = board?.run?.status === "applied";

  const tools: HubTool[] = [
    {
      key: "promote",
      href: "/student-tools?view=promote",
      icon: "grad",
      tone: "acc",
      title: p("Year-end promotion", "वर्ष-अंत प्रमोशन"),
      desc: board ? p(`Move every class up for ${board.targetSessionLabel}`, `हर कक्षा को ${board.targetSessionLabel} में आगे बढ़ाएँ`) : p("Move every class up for next session", "हर कक्षा को अगले सत्र में आगे बढ़ाएँ"),
      status: applied ? p(`Done · ${board?.run?.appliedCount ?? 0} moved up`, `हो गया · ${board?.run?.appliedCount ?? 0} आगे बढ़े`) : p("Opens after annual results — prepare now", "वार्षिक परिणाम के बाद — अभी तैयारी करें"),
      pill: applied ? p("Done", "हो गया") : board ? p(board.targetSessionLabel, board.targetSessionLabel) : undefined,
    },
    {
      key: "import",
      href: "/student-tools?view=import",
      icon: "upload",
      tone: "info",
      title: p("Import from Excel", "Excel से इम्पोर्ट"),
      desc: p("Add many students from one sheet", "एक शीट से कई विद्यार्थी जोड़ें"),
      status: last ? p(`Last import ${dayMonth(last.createdAt)} · ${last.totalRows} rows`, `पिछला इम्पोर्ट ${dayMonth(last.createdAt)} · ${last.totalRows} पंक्तियाँ`) : p("No imports yet", "अभी कोई इम्पोर्ट नहीं"),
      pill: last ? p(dayMonth(last.createdAt), dayMonth(last.createdAt)) : p("Excel or CSV", "Excel या CSV"),
    },
    {
      key: "quality",
      href: "/student-tools?view=quality",
      icon: "shield",
      tone: "warn",
      title: p("Data quality", "डेटा की जाँच"),
      desc: p("Fill gaps and fix mistakes, row by row", "कमियाँ भरें और ग़लतियाँ सुधारें, एक-एक करके"),
      status: p(`${hits.length} things to fix · ${score}% complete`, `${hits.length} सुधार · ${score}% पूरा`),
      ring: score,
    },
    {
      key: "families",
      href: "/student-tools?view=families",
      icon: "users",
      tone: "ok",
      title: p("Families", "परिवार"),
      desc: p("Brothers and sisters, merge and split", "भाई-बहन, जोड़ें और अलग करें"),
      status: p(`${families.length} families · ${withSiblings} with siblings`, `${families.length} परिवार · ${withSiblings} में भाई-बहन`),
      pill: p("Discounts", "छूट"),
    },
  ];

  return {
    sessionLabel,
    toFix: hits.length,
    body: (
      <ToolsHub
        tools={tools}
        history={changes.map((c) => ({ id: c.id, text: c.title, who: c.doneBy, when: dayMonth(c.doneAt) }))}
        emptyHistory={p("No bulk changes yet", "अभी कोई बड़ा बदलाव नहीं")}
      />
    ),
    lang,
  };
}

async function promoteBody(view: "promote" | "promote-review" | "promoted") {
  const board = await loadPromotionBoard();
  const entries = board.detail?.entries ?? [];
  const marks = board.run ? await loadPromotionMarks(board.run.id) : {};
  const targets = board.targetClasses.map((c) => ({ id: c.id, label: c.label }));
  const initialMap: Record<string, string> = {};
  for (const c of board.sourceClasses) {
    // What the run already says wins; otherwise the suggestion.
    const tally = new Map<string, number>();
    for (const e of entries) {
      if (e.previousClassId !== c.id) continue;
      const v = e.decision === "graduate" ? "graduate" : e.decision === "promote" && e.newClassId ? e.newClassId : null;
      if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const guess = best ?? suggestNextClass(c.label, targets);
    if (guess) initialMap[c.id] = guess;
  }
  return (
    <PromoteFlow
      source={board.sourceSessionLabel}
      target={board.targetSessionLabel}
      run={board.run ? { id: board.run.id, status: board.run.status, appliedAt: board.run.appliedAt, appliedCount: board.run.appliedCount, graduatedCount: board.run.graduatedCount } : null}
      sourceClasses={board.sourceClasses.map((c) => ({ id: c.id, label: c.label }))}
      targetClasses={targets}
      entries={entries.map((e) => ({ id: e.id, studentId: e.studentId, name: e.studentName, sr: e.studentAdmissionNo, fromClassId: e.previousClassId, fromLabel: e.previousClassLabel, decision: e.decision, newClassId: e.newClassId }))}
      marks={marks}
      initialMap={initialMap}
      stage={view}
    />
  );
}

async function importBody(view: "import" | "mapping" | "validate" | "imported", batchId: string | null) {
  const sessionLabel = await viewSessionLabel();
  const { batch, recent } = await loadImportBatch(batchId);
  const stage = batch ? view : "import";
  // A few values per column from the first rows, so a column can be recognised by what is in it.
  const samples: Record<string, string[]> = {};
  if (batch) {
    for (const h of batch.detectedHeaders) {
      const seen: string[] = [];
      for (const r of batch.rows) {
        const v = String((r.rawPayload as Record<string, unknown>)?.[h] ?? "").trim();
        if (v && !seen.includes(v)) seen.push(v);
        if (seen.length >= 3) break;
      }
      samples[h] = seen;
    }
  }
  const props: ImportProps = {
    stage,
    sessionLabel,
    recent,
    fields: IMPORT_FIELDS,
    batch: batch
      ? {
          id: batch.id,
          filename: batch.filename,
          status: batch.status,
          headers: batch.detectedHeaders,
          mapping: Object.fromEntries(Object.entries(suggestedMapping(batch)).filter((e): e is [string, string] => typeof e[1] === "string")),
          samples,
          totalRows: batch.totalRows,
          validRows: batch.validRows,
          invalidRows: batch.invalidRows,
          duplicateRows: batch.duplicateRows,
          importedRows: batch.importedRows,
          ready: batch.reviewSummary.readyToImportRows,
          pendingSafe: batch.reviewSummary.pendingSafeRows,
          warningRows: batch.reviewSummary.warningRows,
          rows: batch.rows.map((r) => ({
            id: r.id,
            rowIndex: r.rowIndex,
            name: r.normalizedPayload?.fullName ?? String(Object.values(r.rawPayload)[0] ?? ""),
            classLabel: r.normalizedPayload?.classLabel ?? "",
            status: r.status,
            errors: r.errors.map((e) => e.message),
            warnings: r.warnings,
          })),
        }
      : null,
  };
  return { body: <ImportFlow {...props} />, stage, filename: batch?.filename ?? null, batchId: batch?.id ?? null };
}

async function qualityBody() {
  const sessionLabel = await viewSessionLabel();
  const [children, skipped] = await Promise.all([loadRollChildren(sessionLabel), loadQualitySkips(schoolToday())]);
  const hits = findQualityIssues(children, sessionLabel, skipped);
  return {
    count: hits.length,
    body: (
      <QualityList
        total={children.length}
        score={qualityScore(children.length, hits)}
        items={hits.map((h) => ({ studentId: h.child.id, name: h.child.fullName, classLabel: h.child.classLabel, issue: h.issue, detail: h.issue === "father_phone" ? null : h.detail, otherId: h.otherId ?? null, father: h.child.fatherName }))}
      />
    ),
  };
}

async function familiesBody(mergeKey: string | null) {
  const sessionLabel = await viewSessionLabel();
  const [children, linked] = await Promise.all([loadRollChildren(sessionLabel), loadLinkedFamilies(sessionLabel)]);
  const byId = new Map(children.map((c) => [c.id, c]));
  const groupOf = new Map<string, string>();
  for (const g of linked) for (const id of g.memberIds) groupOf.set(id, g.groupId);
  const families = groupFamilies(children);
  const villageOf = new Map(families.map((f) => [f.key, f.village]));
  const kid = (id: string): FamKid | null => {
    const c = byId.get(id);
    return c ? { id: c.id, name: c.fullName, classLabel: c.classLabel } : null;
  };
  const suggested = suggestFamilies(families, groupOf).map((s) => ({ key: s.key, father: s.father, phone: s.phone, village: villageOf.get(s.key) ?? null, kids: s.childIds.map(kid).filter((k): k is FamKid => k !== null) }));
  const linkedView = linked
    .map((g) => {
      const kids = g.memberIds.map(kid).filter((k): k is FamKid => k !== null);
      const first = byId.get(g.memberIds.find((id) => byId.has(id)) ?? "");
      return { groupId: g.groupId, father: g.label?.trim() || first?.fatherName || "—", phone: first?.phone ?? null, village: first?.villageCity ?? null, kids };
    })
    .filter((g) => g.kids.length > 0);
  return {
    families: families.length,
    withSiblings: families.filter((f) => f.kids.length >= 2).length,
    body: <FamiliesView sessionLabel={sessionLabel} linked={linkedView} suggested={suggested} mergeKey={mergeKey} />,
  };
}
