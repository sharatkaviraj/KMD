import { requirePermission } from "@/platform/auth/current-staff";
import { loadRollChildren } from "@/modules/students-fees/vx/admissions";
import { loadLinkedFamilies } from "@/modules/students-fees/vx/families";
import { IMPORT_FIELDS, loadImportBatch, suggestedMapping } from "@/modules/imports/vx/flow";
import { loadPromotionBoard } from "@/modules/promotion/vx/promote";
import { getActiveSessionLabel } from "@/modules/fees/platform/session-context/active";
import { ago, schoolToday } from "@/vx/format";
import { lead, type Pair } from "@/vx/text";
import type { IconName } from "@/vx/icons";
import { VxPage, TopBar, Section } from "@/vx/ui/page";
import { Card, IconTile, ListRow, Pill, SecHead, EmptyState } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";

import { groupFamilies } from "@/vx/screens/admissions/logic";
import { PeopleStyles } from "@/vx/screens/admissions/ui";
import { listBulkChanges, loadPromotionMarks, loadQualitySkips } from "@/vx/screens/student-tools/data";
import { FamiliesView, type FamKid } from "@/vx/screens/student-tools/families";
import { ImportFlow, type ImportProps } from "@/vx/screens/student-tools/import";
import { findQualityIssues, qualityScore, suggestFamilies, suggestNextClass } from "@/vx/screens/student-tools/logic";
import { PromoteFlow } from "@/vx/screens/student-tools/promote";
import { QualityList } from "@/vx/screens/student-tools/quality";

export const runtime = "nodejs";

const VIEWS = ["hub", "promote", "promote-review", "promoted", "import", "mapping", "validate", "imported", "quality", "families", "merge"] as const;
type View = (typeof VIEWS)[number];

const TITLES: Record<View, Pair> = {
  hub: { en: "Student tools", hi: "स्टूडेंट टूल्स" },
  promote: { en: "Promote to next session", hi: "अगले सत्र में भेजें" },
  "promote-review": { en: "Check the promotion", hi: "प्रमोशन जाँचें" },
  promoted: { en: "Promotion done", hi: "प्रमोशन हो गया" },
  import: { en: "Import students", hi: "विद्यार्थी इम्पोर्ट करें" },
  mapping: { en: "Match the columns", hi: "कॉलम मिलाएँ" },
  validate: { en: "Check the rows", hi: "पंक्तियाँ जाँचें" },
  imported: { en: "Import done", hi: "इम्पोर्ट हो गया" },
  quality: { en: "Data quality", hi: "डेटा की जाँच" },
  families: { en: "Families", hi: "परिवार" },
  merge: { en: "Link a family", hi: "परिवार जोड़ें" },
};

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** Student tools: promote, import, data quality and families (SCREENS.md "Student tools"). */
export default async function StudentToolsPage(props: PageProps<"/student-tools">) {
  await requirePermission("fees:manage", "/student-tools");
  const params = await props.searchParams;
  const raw = one(params.view);
  const view: View = (VIEWS as readonly string[]).includes(raw) ? (raw as View) : "hub";
  const { staff } = await getViewer();
  const lang = staff.language;

  let body: React.ReactNode;
  if (view === "promote" || view === "promote-review" || view === "promoted") body = await promoteBody(view);
  else if (view === "import" || view === "mapping" || view === "validate" || view === "imported") body = await importBody(view, one(params.batch) || null);
  else if (view === "quality") body = await qualityBody();
  else if (view === "families" || view === "merge") body = await familiesBody(one(params.merge) || null);
  else body = await hubBody(lang);

  return (
    <VxPage>
      <TopBar
        crumb={view === "hub" ? lead({ en: "Students", hi: "विद्यार्थी" }, lang) : lead(TITLES.hub, lang)}
        title={lead(TITLES[view], lang)}
        mBack={view === "hub" ? "/menu" : "/student-tools"}
      />
      <main>
        <Section gap={16}>{body}</Section>
      </main>
    </VxPage>
  );
}

async function hubBody(lang: Parameters<typeof lead>[1]) {
  const [changes, board] = await Promise.all([listBulkChanges(8), loadPromotionBoard().catch(() => null)]);
  const tiles: { href: string; icon: IconName; title: Pair; sub: Pair; badge?: string }[] = [
    {
      href: "/student-tools?view=promote",
      icon: "grad",
      title: { en: "Promote to next session", hi: "अगले सत्र में भेजें" },
      sub: board ? { en: `${board.sourceSessionLabel} → ${board.targetSessionLabel}`, hi: `${board.sourceSessionLabel} → ${board.targetSessionLabel}` } : { en: "Once a year", hi: "साल में एक बार" },
      badge: board?.run?.status === "applied" ? lead({ en: "Done", hi: "हो गया" }, lang) : undefined,
    },
    { href: "/student-tools?view=import", icon: "upload", title: { en: "Import students", hi: "विद्यार्थी इम्पोर्ट करें" }, sub: { en: "From an Excel or CSV file", hi: "Excel या CSV फ़ाइल से" } },
    { href: "/student-tools?view=quality", icon: "clipboard", title: { en: "Data quality", hi: "डेटा की जाँच" }, sub: { en: "Missing phones, birth dates, twins", hi: "फ़ोन, जन्म तिथि, दोहराव" } },
    { href: "/student-tools?view=families", icon: "users", title: { en: "Families", hi: "परिवार" }, sub: { en: "Link and split brothers and sisters", hi: "भाई-बहन जोड़ें और अलग करें" } },
  ];
  const kindIcon: Record<string, IconName> = { promote: "grad", promote_undo: "undo", import: "upload", merge: "link", split: "users", quality: "check" };
  return (
    <div className="pp-wrap" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeopleStyles />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        {tiles.map((t) => (
          <a key={t.href} href={t.href} className="card tap" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "16px 18px", color: "inherit", textDecoration: "none" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconTile icon={t.icon} />
              {t.badge ? <Pill tone="ok">{t.badge}</Pill> : null}
            </span>
            <strong style={{ fontSize: 16 }}>{lead(t.title, lang)}</strong>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{lead(t.sub, lang)}</span>
          </a>
        ))}
      </div>
      <SecHead>{lead({ en: "Recent bulk changes", hi: "हाल के बड़े बदलाव" }, lang)}</SecHead>
      <Card pad={false}>
        {changes.length === 0 ? (
          <EmptyState icon="history" title={lead({ en: "No bulk changes yet", hi: "अभी कोई बड़ा बदलाव नहीं" }, lang)} />
        ) : (
          changes.map((c) => <ListRow key={c.id} lead={<IconTile icon={kindIcon[c.kind] ?? "history"} size={36} />} title={c.title} sub={ago(c.doneAt)} />)
        )}
      </Card>
    </div>
  );
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
  const sessionLabel = await getActiveSessionLabel();
  const { batch, recent } = await loadImportBatch(batchId);
  const stage = batch ? view : "import";
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
  return <ImportFlow {...props} />;
}

async function qualityBody() {
  const sessionLabel = await getActiveSessionLabel();
  const [children, skipped] = await Promise.all([loadRollChildren(sessionLabel), loadQualitySkips(schoolToday())]);
  const hits = findQualityIssues(children, sessionLabel, skipped);
  return (
    <QualityList
      total={children.length}
      score={qualityScore(children.length, hits)}
      items={hits.map((h) => ({ studentId: h.child.id, name: h.child.fullName, classLabel: h.child.classLabel, issue: h.issue, detail: h.issue === "father_phone" ? null : h.detail, otherId: h.otherId ?? null }))}
    />
  );
}

async function familiesBody(mergeKey: string | null) {
  const sessionLabel = await getActiveSessionLabel();
  const [children, linked] = await Promise.all([loadRollChildren(sessionLabel), loadLinkedFamilies(sessionLabel)]);
  const byId = new Map(children.map((c) => [c.id, c]));
  const groupOf = new Map<string, string>();
  for (const g of linked) for (const id of g.memberIds) groupOf.set(id, g.groupId);
  const families = groupFamilies(children);
  const kid = (id: string): FamKid | null => {
    const c = byId.get(id);
    return c ? { id: c.id, name: c.fullName, classLabel: c.classLabel } : null;
  };
  const suggested = suggestFamilies(families, groupOf).map((s) => ({ key: s.key, father: s.father, phone: s.phone, kids: s.childIds.map(kid).filter((k): k is FamKid => k !== null) }));
  const linkedView = linked
    .map((g) => {
      const kids = g.memberIds.map(kid).filter((k): k is FamKid => k !== null);
      const first = byId.get(g.memberIds.find((id) => byId.has(id)) ?? "");
      return { groupId: g.groupId, father: g.label?.trim() || first?.fatherName || "—", phone: first?.phone ?? null, kids };
    })
    .filter((g) => g.kids.length > 0);
  return <FamiliesView sessionLabel={sessionLabel} linked={linkedView} suggested={suggested} mergeKey={mergeKey} />;
}
