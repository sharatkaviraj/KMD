import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/platform/i18n/use-language';
import { Student360, type Student360Props } from '@/vx/screens/admin/student360';
import { StudentsScreen, type StudentsProps } from '@/vx/screens/admin/students';
import { studentReturnHref } from '@/vx/screens/admin/students-logic';
import { NavTrail } from '@/vx/ui/back-link';
import { ToastProvider } from '@/vx/ui/overlays';
import { VxPage } from '@/vx/ui/page';
import { usePathname, useSearchParams } from '../operations-admin/navigation';
import { siblingActionAttempts } from './actions';
import '../../src/app/globals.css';
import '../../src/vx/vx.css';

const primaryId = '00000000-0000-4000-8000-000000000201';
const siblingId = '00000000-0000-4000-8000-000000000202';
const classId = 'qa-sibling-context';
const family = [
  { id: primaryId, name: 'QA Sibling Context Primary', sr: 'QA-CONTEXT-201', classLabel: 'QA Context Class' },
  { id: siblingId, name: 'QA Sibling Context Sibling', sr: 'QA-CONTEXT-202', classLabel: 'QA Context Other Class' },
];
const base: Omit<Student360Props, 'id' | 'name' | 'sr' | 'classLabel'> = {
  rollNo: '1', status: 'active', father: null, mother: null, phone: null, address: null, dob: null, joined: null, route: null,
  tab: 'overview', tabs: ['overview', 'family'], money: null, installments: null, feeSummary: null, feeBreakup: null,
  feeSession: null, receipts: null, family: null, attendance: { percent: null, counted: 0,
    counts: { present: 0, absent: 0, half_day: 0, late: 0, leave: 0 }, weeks: [] },
  terms: [], documents: [], notes: [], history: [], today: '2026-10-11', canCollect: false,
  canManageDocuments: false, canManageFees: false, canAddNote: false, contacts: null,
};
function Fixture() {
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = family.find(child => pathname === `/students/${child.id}`);
  const props: StudentsProps = {
    session: 'QA-SIBLING-CONTEXT', rows: family.map(child => ({ id: child.id, name: child.name, sr: child.sr,
      classLabel: child.classLabel, rollNo: '1', route: null, parent: null, phone: null,
      money: { pendingToday: 100, notDueYet: 0, lateFee: 0, percent: 0 },
      facts: { attendance: null, siblings: 1, isNew: false, route: null, yearClear: false, emi: null, concessions: [] },
    })), total: 26, window: { page: Number(params.get('page')) || 1, pages: 3, firstRow: 13, lastRow: 14 },
    q: params.get('q') ?? '', classId: params.get('class'), view: 'fees', seg: 'pending',
    classes: [{ id: classId, label: 'QA Context Class' }], counts: { all: 26, pending: 26 }, seesMoney: true,
    attendanceRead: true, viewKey: 'qa-sibling-context-admin', canCollect: false, canAdmit: false,
    canRemind: false, failed: false,
  };
  return <LanguageProvider language="en"><ToastProvider><NavTrail />
    <div className="vxt vx-shell"><div className="vx-content"><main id="vx-main" className="vx-main vx-reset">
      <VxPage label="Synthetic sibling context">
        {selected ? <Student360 key={selected.id} p={{ ...base, ...selected,
          returnTo: studentReturnHref(params.get('returnTo')),
          family: family.map(child => ({ ...child, self: child.id === selected.id })),
        }} /> : <StudentsScreen {...props} />}
      </VxPage>
    </main></div></div>
    <div id="vx-layer" className="vxt vx-layer" />
  </ToastProvider></LanguageProvider>;
}
Object.assign(window, { siblingActionAttempts });
createRoot(document.getElementById('root')!).render(<Fixture />);
