"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { normaliseQuery } from "@/modules/students/domain/directory";

const SEARCH_PAUSE_MS = 250;
type SearchState = {
  value: string;
  pending: boolean;
  change: (value: string) => void;
  submit: () => void;
  startComposition: () => void;
  finishComposition: (value: string) => void;
};
const SearchContext = createContext<SearchState | null>(null);

/** Only the search controls consume this state; typing leaves the row tree alone. */
export function StudentSearchProvider({ query, href, children }: { query: string; href: string; children: ReactNode }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ query, href, value: query, sent: [] as string[], generation: 0 });
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  const target = useRef<{ query: string; href: string; pending?: string }>({ query, href });

  // External navigation owns the query again; an acknowledgment of our own
  // request must preserve anything typed since that request started.
  if (draft.query !== query || draft.href !== href) {
    const acknowledged = draft.href === href ? draft.sent.indexOf(normaliseQuery(query)) : -1;
    setDraft({ query, href, value: acknowledged >= 0 ? draft.value : query,
      sent: acknowledged >= 0 ? draft.sent.slice(acknowledged + 1) : [],
      generation: draft.generation + (acknowledged >= 0 ? 0 : 1) });
  }
  useEffect(() => { target.current = { query, href, pending: draft.sent.at(-1) }; }, [query, href, draft.sent]);
  useEffect(() => {
    composing.current = false;
    return () => clearTimeout(timer.current);
  }, [draft.generation]);
  useEffect(() => {
    const back = () => {
      clearTimeout(timer.current);
      setDraft(current => ({ ...current, sent: [] }));
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);

  const navigate = (value: string) => {
    clearTimeout(timer.current);
    const next = normaliseQuery(value);
    if (next === target.current.pending || (target.current.pending === undefined && next === normaliseQuery(target.current.query))) return;
    const url = new URL(target.current.href, "https://students.invalid");
    if (next) url.searchParams.set("q", next);
    else url.searchParams.delete("q");
    url.searchParams.delete("page");
    setDraft(current => ({ ...current, sent: [...current.sent, next].slice(-20) }));
    startTransition(() => router.replace(`${url.pathname}${url.search}`, { scroll: false }));
  };
  const schedule = (value: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => navigate(value), SEARCH_PAUSE_MS);
  };

  return <SearchContext.Provider value={{
    value: draft.value,
    pending: pending || normaliseQuery(draft.value) !== normaliseQuery(query),
    change: value => {
      setDraft(current => ({ ...current, value }));
      if (!composing.current) schedule(value);
    },
    submit: () => { if (!composing.current) navigate(draft.value); },
    startComposition: () => { composing.current = true; clearTimeout(timer.current); },
    finishComposition: value => { composing.current = false; schedule(value); },
  }}>{children}</SearchContext.Provider>;
}

function useStudentSearch() {
  const search = useContext(SearchContext);
  if (!search) throw new Error("Student search needs its provider.");
  return search;
}

export function StudentSearchForm(props: Omit<ComponentProps<"form">, "onSubmit">) {
  const search = useStudentSearch();
  return <form {...props} action="/students" method="get" role="search" aria-busy={search.pending} onSubmit={event => { event.preventDefault(); search.submit(); }} />;
}

export function StudentSearchInput(props: Omit<ComponentProps<"input">, "value" | "onChange" | "onCompositionStart" | "onCompositionEnd">) {
  const search = useStudentSearch();
  return <input {...props} type="search" name="q" value={search.value} onChange={event => search.change(event.target.value)}
    onCompositionStart={search.startComposition} onCompositionEnd={event => search.finishComposition(event.currentTarget.value)} />;
}
