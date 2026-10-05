# Next-stage native workflow parity

This branding/navigation release routes staff into VPPS One's existing native
modules. It does not certify full parity with the original applications and
does not perform a production database cutover. The sibling checkouts remain
read-only references. `docs/PARITY.md` supplies the older detailed source map;
its historical statuses require fresh verification.

| Original area | Native implementation available | Next acceptance work |
| --- | --- | --- |
| Fees: collection, dues, allocation, receipt history | `/fees/payments`, `/fees/dues`, `/fees/receipts`, `/fees/transactions` and the original financial modules | Compare an identical test student/session against the Fees app; confirm allocation, policy, receipt output and role boundaries |
| Fees: follow-up, reminders, repayment and recovery | `/fees/defaulters`, `/fees/reminders` and repayment/recovery modules | Verify every supported action, filter, template and permission against the original |
| Fees: setup, imports, exports and financial controls | Native fee setup/admin/finance routes | Reconcile the source screen inventory; verify validations, exports and permission denials |
| SamPark: requests, rounds and review | `/collection`, `/collection/rounds`, `/collection/review`, token routes | Compare frozen audiences, class/route/house/subject filters, fan-out, gaps, master/office links and autosave/resume |
| SamPark: records, photos and communication | Native collection records/photos/messages and student records | Verify provenance, correction precedence, photo placement, bulk download and communication workflows with equivalent fixtures |
| TimeTable: teacher/class views and cover | `/timetable`, `/substitutions`, `/academics` and native import/setup | Compare each class/teacher/day, period timing, import validation, printing and cover rules against the original schedule |

## Admin usability priorities for the next plan

1. Populate the admin fee summary from the existing authorised native data source
   using the same selected session; continue distinguishing unavailable data from
   a real zero.
2. Unify the student entry and context across academic records, Collection and
   Fees while retaining the original fee controls and calculations.
3. Walk complete SamPark and TimeTable workflows against the source apps and
   identify missing behaviour before simplifying their controls.
4. Decide on production data migration/cutover only after parity and staff
   acceptance. Native navigation never implies that dev and live data are the
   same, and the existing environment/session indicators remain visible.

Use deterministic dev fixtures and record source commit, test case and actual
result for each parity row. Broad live financial writes and closing the original
applications are outside this release.
