import { Component, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/platform/i18n/use-language';
import { TeachAttend } from '@/vx/screens/teach/ui/attend';
import type { AttendData } from '@/vx/screens/teach/data';
import { TeachNotes, type NotesProps } from '@/vx/screens/notes/ui/workspace';
import { VxBottomBar } from '@/vx/shell/bottom-bar';
import { OfflineBanner } from '@/vx/screens/system/offline-banner';
import type { BottomTab } from '@/vx/nav';
import { ToastProvider } from '@/vx/ui/overlays';
import { snapshot } from './actions';
import '../../src/app/globals.css';
import '../../src/vx/vx.css';
import '../../src/vx/screens/teach/ui/teach.css';

const classId = '00000000-0000-4000-8000-000000000001';
const roll = Array.from({ length: 24 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`, name: `QA Follow-up Child ${index + 1}`, rollNo: String(index + 1), gender: null, birthday: false }));
const fresh = { kind: 'class', sessionLabel: 'QA-followup', classId, classLabel: 'QA Follow-up Class', day: '2026-10-10', prevDay: '2026-10-09', choices: [], closed: false, canSave: true, canCorrect: true, isOwner: true, correctsAny: false, onBehalf: false, reason: null, roll, registerId: null, revision: 0, saved: {}, yesterday: {}, receipt: null, queuedAlerts: [], month: '2026-10', monthMarks: [], closedDays: [] } as AttendData;
function readback(): AttendData {
  const row = snapshot().attendance[0];
  return row ? { ...fresh, revision: row.revision, registerId: 'qa-register', saved: Object.fromEntries(row.marks.map(mark => [mark.studentId, mark.status])), receipt: { savedAt: '2026-10-11T08:00:00Z', registerId: 'qa-register', revision: 1, actorName: 'QA Teacher' } } as AttendData : fresh;
}
const notes: NotesProps = { notes: [], plans: [], kids: roll.map(child => ({ id: child.id, name: child.name, classId, classLabel: fresh.classLabel })), viewer: { id: 'qa-followup-teacher', name: 'QA Teacher', readsEveryClass: false, correctsAttendance: false, heldClassIds: [classId], canWrite: true }, today: '2026-10-11', school: 'QA School', focus: null, initialSheet: null, initialStep: 'add', initialStudent: roll[0].id };
const tabs = [
  { key: 'teach', href: '/teach', icon: 'home', label: { en: 'Today' } },
  { key: 'class', href: '/teach/class', icon: 'users', label: { en: 'Class' } },
  { key: 'notes', href: '/teach/notes', icon: 'note', label: { en: 'Notes' } },
  { key: 'more', href: '/teach/more', icon: 'menu', label: { en: 'More' } },
] as BottomTab[];
class TransportBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div role="alert" data-qa-boundary="true">Synthetic boundary caught a rejected transport. Product form unmounted.</div> : this.props.children; }
}
function Fixture() {
  const [data, setData] = useState(readback);
  const mode = new URLSearchParams(location.search).get('mode') ?? 'attendance';
  useEffect(() => { const update = () => setData(readback()); window.addEventListener('qa:refresh', update); return () => window.removeEventListener('qa:refresh', update); }, []);
  return <LanguageProvider language="en"><ToastProvider>
    <div className="vxt vx-shell">
      <div className="vx-content">
        <OfflineBanner />
        <main id="vx-main" className="vx-main vx-reset">
          <TransportBoundary>{mode === 'notes' ? <TeachNotes {...notes} /> : <TeachAttend data={data} ownerId="qa-followup-teacher" initialSheet={null} initialView={null} school="QA School" />}</TransportBoundary>
        </main>
      </div>
      <VxBottomBar tabs={tabs} badges={Promise.resolve({ inbox: 0, notes: 0, dues: 0, books: 0, marks: 0, news: 0 })} />
    </div>
    <div id="vx-layer" className="vxt vx-layer" />
  </ToastProvider></LanguageProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
