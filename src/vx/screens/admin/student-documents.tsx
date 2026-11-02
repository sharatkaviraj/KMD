"use client";

import { Component, createContext, lazy, Suspense, useContext, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { dateLabel } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";
import { removeStudentDocument } from "@/vx/screens/admin/student-document-actions";
import type { Student360Props } from "./student360";
import "./student-documents.css";

const Upload = lazy(() => import("./student-document-upload").then(mod => ({ default: mod.StudentDocumentUpload })));
const D = {
  title: p("Uploaded documents", "अपलोड किए दस्तावेज़"),
  hint: p("Student records, PDFs and photos", "विद्यार्थी के कागज़, PDF और फ़ोटो"),
  add: p("Add document", "दस्तावेज़ जोड़ें"),
  empty: p("No documents yet", "अभी कोई दस्तावेज़ नहीं है"),
  emptyHint: p("Keep this student's certificates and other records together here.", "विद्यार्थी के प्रमाणपत्र और दूसरे कागज़ यहाँ साथ रखें।"),
  limit: p("PDF or photo · up to 10 MB", "PDF या फ़ोटो · अधिकतम 10 MB"),
  failed: p("Documents could not be loaded. Try again.", "दस्तावेज़ नहीं खुल पाए। फिर कोशिश करें।"),
  retry: p("Try again", "फिर कोशिश करें"),
  open: p("Open", "खोलें"),
  remove: p("Remove document", "दस्तावेज़ हटाएँ"),
  removeTitle: p("Remove document?", "दस्तावेज़ हटाएँ?"),
  removeHint: p("This document will be removed from the student's files.", "यह दस्तावेज़ विद्यार्थी की फ़ाइलों से हट जाएगा।"),
  removeFailed: p("Could not remove the document. Please try again.", "दस्तावेज़ नहीं हटा पाए। फिर कोशिश करें।"),
  removing: p("Removing…", "हटा रहे हैं…"),
  cancel: p("Cancel", "रहने दें"),
  saved: p("Document saved.", "दस्तावेज़ रख लिया गया।"),
  removed: p("Document removed.", "दस्तावेज़ हटा दिया गया।"),
  loading: p("Loading…", "खोल रहे हैं…"),
  loadFailed: p("Could not open the upload form. Refresh and try again.", "अपलोड फ़ॉर्म नहीं खुला। पेज दोबारा खोलकर कोशिश करें।"),
};

function UploadLoading({ failed = false, onClose }: { failed?: boolean; onClose: () => void }) {
  const { tx } = useVx();
  return <Sheet open title={tx(D.add)} onClose={onClose} footer={<><Btn full onClick={onClose}>{tx(D.cancel)}</Btn>{failed ? <Btn full variant="pri" onClick={() => window.location.reload()}>{tx(D.retry)}</Btn> : null}</>}>
    <p role={failed ? "alert" : "status"} className={failed ? "sd-error" : "sd-muted"}>{tx(failed ? D.loadFailed : D.loading)}</p>
  </Sheet>;
}

class UploadBoundary extends Component<{ onClose: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <UploadLoading failed onClose={this.props.onClose} /> : this.props.children; }
}

type ProfileDocument = Student360Props["documents"][number];
const DocumentContext = createContext<{
  addTrigger: RefObject<HTMLSpanElement | null>;
  add: () => void;
  askRemove: (document: ProfileDocument) => void;
  notice: "saved" | "removed" | null;
  removedIds: string[];
} | null>(null);

/** Above the fee Suspense boundary: a late fee read must not discard a file or an active request. */
export function StudentDocumentWorkspace({ studentId, uploadMode, children }: {
  studentId: string;
  uploadMode?: "supabase" | "gdrive" | "unavailable";
  children: ReactNode;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const addTrigger = useRef<HTMLSpanElement>(null);
  const [upload, setUpload] = useState(false);
  const [selected, setSelected] = useState<Student360Props["documents"][number] | null>(null);
  const [removing, setRemoving] = useState(false);
  const removingRef = useRef(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [notice, setNotice] = useState<"saved" | "removed" | null>(null);
  // A successful removal is reflected immediately; failures keep their row.
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  function closeUpload() {
    setUpload(false);
    addTrigger.current?.querySelector("button")?.focus();
  }

  async function remove() {
    if (!selected || removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    setRemoveFailed(false);
    try {
      const result = await removeStudentDocument(selected.id);
      if (!result.ok) { setRemoveFailed(true); return; }
      setRemovedIds(ids => [...ids, selected.id]);
      setSelected(null);
      setNotice("removed");
      router.refresh();
    } catch { setRemoveFailed(true); }
    finally { removingRef.current = false; setRemoving(false); }
  }

  return <DocumentContext value={{ addTrigger, notice, removedIds, add: () => { setNotice(null); setUpload(true); }, askRemove: document => { setRemoveFailed(false); setSelected(document); } }}>
    {children}
    {upload ? <UploadBoundary onClose={closeUpload}><Suspense fallback={<UploadLoading onClose={closeUpload} />}><Upload studentId={studentId} mode={uploadMode ?? "unavailable"} onClose={closeUpload} onSaved={() => { closeUpload(); setNotice("saved"); router.refresh(); }} /></Suspense></UploadBoundary> : null}
    <Sheet open={selected !== null} title={tx(D.removeTitle)} icon="trash" dismissable={!removing} onClose={() => setSelected(null)}
      footer={<><Btn full disabled={removing} onClick={() => setSelected(null)}>{tx(D.cancel)}</Btn><Btn full variant="danger" disabled={removing} onClick={remove}>{tx(removing ? D.removing : D.remove)}</Btn></>}>
      <div className="sd-form"><strong className="sd-break">{selected?.fileName}</strong><p className="sd-muted">{tx(D.removeHint)}</p>{removeFailed ? <p className="sd-error" role="alert">{tx(D.removeFailed)}</p> : null}</div>
    </Sheet>
  </DocumentContext>;
}

export function StudentDocuments({ documents, canManage, unavailable = false }: {
  documents: Student360Props["documents"]; canManage: boolean; unavailable?: boolean;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const heading = useId();
  const controls = useContext(DocumentContext);
  if (!controls) throw new Error("Student documents require their workspace.");
  const { notice, removedIds, addTrigger, add, askRemove } = controls;
  const rows = documents.filter(document => !removedIds.includes(document.id));
  return (
    <section className="card sd-documents" aria-labelledby={heading}>
      <div className="sd-header">
        <div className="sd-heading">
          <h2 id={heading}><Bi {...D.title} />{!unavailable ? <span className="sd-count">{rows.length}</span> : null}</h2>
          <p className="sd-muted">{tx(D.hint)}</p>
        </div>
        {canManage ? <span ref={addTrigger}><Btn variant="pri" icon="plus" onClick={add}>{tx(D.add)}</Btn></span> : null}
      </div>
      {notice ? <p role="status" className="sd-notice"><Ic n="checkCircle" size={17} />{tx(D[notice])}</p> : null}
      {unavailable ? <div className="sd-empty" role="alert"><Ic n="wifiOff" size={28} /><p>{tx(D.failed)}</p><Btn icon="refresh" onClick={() => router.refresh()}>{tx(D.retry)}</Btn></div>
        : rows.length ? <ul className="sd-list">{rows.map(document => <li key={document.id} className="sd-item">
          <a href={`/documents/${document.id}`} target="_blank" rel="noopener noreferrer" className="sd-open tap" aria-label={`${tx(D.open)} ${document.kind}: ${document.fileName}`}>
            <span className="sd-icon"><Ic n="fileText" size={21} /></span>
            <span className="sd-file"><strong>{document.kind}</strong><span className="sd-name">{document.fileName}</span><span className="sd-muted sd-meta">{document.size} · {dateLabel(document.createdAt)}</span></span>
            <span className="sd-open-word">{tx(D.open)}<Ic n="chevRight" size={16} /></span>
          </a>
          {canManage ? <button type="button" className="tap sd-remove" aria-label={tx(p(`Remove ${document.fileName}`, `${document.fileName} हटाएँ`))} onClick={() => askRemove(document)}><Ic n="trash" size={18} /></button> : null}
        </li>)}</ul> : <div className="sd-empty"><span className="sd-empty-icon"><Ic n="fileText" size={28} /></span><strong>{tx(D.empty)}</strong><p className="sd-muted">{tx(D.emptyHint)}</p></div>}
      <p className="sd-limit sd-muted"><Ic n="file" size={14} />{tx(D.limit)}</p>
    </section>
  );
}
