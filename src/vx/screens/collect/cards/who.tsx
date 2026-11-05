"use client";

import { useRef } from "react";

import { mc } from "@/messages/collect";
import { isHouseholdSearch, queryShape, type QueryShape } from "@/modules/collect/domain/search";
import type { CollectStudentRow, LikelyRow } from "@/modules/collect/domain/types";
import type { Localized } from "@/platform/i18n/language";

import { avatarTone, CardShell, Icon, initialsOf, useFit, type IconName } from "../parts";
import { Bi, fill, money, useCx } from "../text";

export type Found = { q: string; rows: CollectStudentRow[]; loading: boolean; error: string | null };

const REASON: Record<LikelyRow["reason"], { text: Localized; tone: string }> = {
  sibling_of_last: { text: mc.likelySibling, tone: "acc" },
  paid_recently: { text: mc.likelyRecent, tone: "mut" },
  overdue_late: { text: mc.likelyOverdueLate, tone: "warn" },
  overdue: { text: mc.likelyOverdue, tone: "warn" },
};

function shapeLabel(shape: QueryShape): { icon: IconName; text: Localized } {
  switch (shape.kind) {
    case "empty":
      return { icon: "users", text: mc.shapeLikely };
    case "name":
      return { icon: "search", text: mc.shapeName };
    case "class":
      return { icon: "list", text: fill(mc.shapeClass, { name: `${shape.grade.toUpperCase()}${shape.section.toUpperCase()}` }) };
    case "sr":
      return { icon: "search", text: mc.shapeSr };
    case "phone":
      return { icon: "users", text: mc.shapePhone };
    case "phonepart":
      return { icon: "users", text: mc.shapePhonePart };
    case "hindi":
      return { icon: "search", text: mc.shapeHindi };
  }
}

export function WhoCard({ inputRef, ...props }: {
  query: string;
  onQuery: (q: string) => void;
  found: Found;
  likely: readonly LikelyRow[];
  highlight: number;
  onPick: (row: CollectStudentRow, all: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { p, f } = useCx();
  const shape = queryShape(props.query);
  const searching = shape.kind !== "empty";
  const rows: Array<CollectStudentRow & { reason?: LikelyRow["reason"] }> = searching ? props.found.rows : [...props.likely];
  const box = useRef<HTMLDivElement>(null);
  const cut = useFit(box, ".cx-res", [rows.length, props.query, props.found.loading]);
  const household = isHouseholdSearch(shape, rows.length);
  const owing = rows.filter((r) => r.fees > 0);
  const label = shapeLabel(shape);
  const hl = rows.length ? Math.min(props.highlight, rows.length - 1) : 0;

  return (
    <CardShell
      eyebrow={mc.stepWho}
      title={mc.whoTitle}
      foot={
        <>
          <div className="cx-hint deskonly">
            <span>
              <span className="cx-k">↑</span> <span className="cx-k">↓</span> {p(mc.hintChoose)}
            </span>
            <span>
              <span className="cx-k">Enter</span> {p(mc.hintOpen)}
            </span>
          </div>
          <button type="button" className="cx-btn pri" disabled={!rows.length || (searching && props.found.loading)} onClick={() => rows[hl] && props.onPick(rows[hl], false)}>
            <Bi text={mc.openChild} />
          </button>
        </>
      }
    >
      <label className="cx-search">
        <Icon name="search" size={20} />
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={f(mc.searchPlaceholder)}
          aria-label={f(mc.searchPlaceholder)}
          value={props.query}
          maxLength={100}
          onChange={(e) => props.onQuery(e.target.value)}
        />
      </label>
      <div className="cx-shape">
        <Icon name={label.icon} size={14} />
        <Bi text={label.text} inline />
        {searching && props.found.loading ? <span className="cx-hin">{p(mc.searching)}</span> : null}
      </div>
      {household && owing.length > 1 ? (
        <div className="cx-hh">
          <span>
            <Icon name="users" size={16} />
            <Bi text={fill(mc.familyFound, { n: rows.length })} inline />
          </span>
          <button type="button" className="cx-btn pri sm" style={{ flex: "none" }} onClick={() => props.onPick(owing[0], true)}>
            {p(mc.collectForAll)}
          </button>
        </div>
      ) : null}
      <div className="cx-results" ref={box} role="listbox" aria-label={f(mc.whoTitle)}>
        {rows.length ? (
          rows.map((row, i) => (
            <button
              type="button"
              key={row.id}
              role="option"
              aria-selected={i === hl}
              className={`cx-res${i === hl ? " hl" : ""}`}
              onClick={() => props.onPick(row, false)}
            >
              <span className={`cx-av ${avatarTone(row.id)}`}>{initialsOf(row.name)}</span>
              <span className="cx-rc">
                <span className="cx-rn">{row.name}</span>
                <span className="cx-rm">
                  {row.classLabel} · SR {row.sr}
                  {row.father ? ` · ${row.father}` : ""}
                  {row.siblings > 0 && !row.reason && !household ? ` · +${row.siblings}` : ""}
                </span>
                {row.reason ? <span className={`cx-tag ${REASON[row.reason].tone}`}>{p(REASON[row.reason].text)}</span> : null}
              </span>
              <span className="cx-ra">
                {row.fees > 0 ? <b>{money(row.fees)}</b> : <b className="cx-okc">{p(mc.clear)} ✓</b>}
                {row.late > 0 ? <span className="cx-latec">{p(mc.lateShort)} {money(row.late)}</span> : null}
              </span>
            </button>
          ))
        ) : (
          <div className="cx-empty">
            <Bi text={searching ? (props.found.error ? mc.searchFailed : props.found.loading ? mc.searching : mc.noMatch) : mc.typeToBegin} />
          </div>
        )}
      </div>
      {cut > 0 && searching ? (
        <div className="cx-more">
          <Bi text={fill(mc.moreResults, { n: cut })} inline />
        </div>
      ) : null}
    </CardShell>
  );
}
