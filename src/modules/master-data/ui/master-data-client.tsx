"use client";

import { useActionState, useState } from "react";

import { PendingSubmitButton } from "@/ui/shell/pending-submit-button";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import type { ClassStatus } from "@/platform/db/types";
import type { MasterDataActionState } from "@/app/(app)/fees/master-data/actions";

import { useActionFeedbackMany } from "@/ui/hooks/use-action-feedback";
import { AddRow, EditRow } from "@/ui/primitives/edit-row";
const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type SessionItem = {
  id: string;
  session_label: string;
  status: ClassStatus;
  is_current: boolean;
  notes: string | null;
};

type ClassItem = {
  id: string;
  session_label: string;
  class_name: string;
  section: string | null;
  stream_name: string | null;
  sort_order: number;
  status: ClassStatus;
  notes: string | null;
};

type RouteItem = {
  id: string;
  route_code: string | null;
  route_name: string;
  default_installment_amount: number;
  is_active: boolean;
  notes: string | null;
};

type FeeHeadItem = {
  id: string;
  label: string;
  isActive: boolean;
};

type PaymentModeItem = {
  value: string;
  label: string;
  isActive: boolean;
};

type ActionFn = (
  previous: MasterDataActionState,
  formData: FormData,
) => Promise<MasterDataActionState>;

type MasterDataClientProps = {
  sessions: SessionItem[];
  classes: ClassItem[];
  routes: RouteItem[];
  feeHeads: FeeHeadItem[];
  paymentModes: PaymentModeItem[];
  actions: {
    createSessionAction: ActionFn;
    updateSessionAction: ActionFn;
    deleteSessionAction: ActionFn;
    setLiveActiveSessionAction: ActionFn;
    createClassAction: ActionFn;
    updateClassAction: ActionFn;
    deleteClassAction: ActionFn;
    createRouteAction: ActionFn;
    updateRouteAction: ActionFn;
    deleteRouteAction: ActionFn;
    createFeeHeadAction: ActionFn;
    updateFeeHeadAction: ActionFn;
    deleteFeeHeadAction: ActionFn;
    setPaymentModeActiveAction: ActionFn;
  };
  initialActionState: MasterDataActionState;
};

function ActionMessage({ state }: { state: MasterDataActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <div
      className={
        state.status === "error"
          ? "rounded-md border bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground"
          : "rounded-md border bg-success-soft px-3 py-2 text-sm text-success-soft-foreground"
      }
    >
      {state.message}
    </div>
  );
}

const STATUS_LABELS: Record<ClassStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

/** Deleting a class, route or fee head used to happen on one tap. */
function confirmDelete(what: string) {
  return (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!window.confirm(`Delete ${what}? This cannot be undone.`)) event.preventDefault();
  };
}

function SessionStatusSelect({ name, value }: { name: string; value: ClassStatus }) {
  return (
    <select name={name} defaultValue={value} className={selectClassName}>
      <option value="active">Active</option>
      <option value="inactive">Inactive</option>
      <option value="archived">Archived</option>
    </select>
  );
}

export function MasterDataClient({
  sessions,
  classes,
  routes,
  feeHeads,
  paymentModes,
  actions,
  initialActionState,
}: MasterDataClientProps) {
  const [sessionCreateState, createSessionFormAction] = useActionState(
    actions.createSessionAction,
    initialActionState,
  );
  const [sessionUpdateState, updateSessionFormAction] = useActionState(
    actions.updateSessionAction,
    initialActionState,
  );
  const [sessionDeleteState, deleteSessionFormAction] = useActionState(
    actions.deleteSessionAction,
    initialActionState,
  );
  const [setLiveSessionState, setLiveSessionFormAction] = useActionState(
    actions.setLiveActiveSessionAction,
    initialActionState,
  );

  const [classCreateState, createClassFormAction] = useActionState(
    actions.createClassAction,
    initialActionState,
  );
  const [classUpdateState, updateClassFormAction] = useActionState(
    actions.updateClassAction,
    initialActionState,
  );
  const [classDeleteState, deleteClassFormAction] = useActionState(
    actions.deleteClassAction,
    initialActionState,
  );

  const [routeCreateState, createRouteFormAction] = useActionState(
    actions.createRouteAction,
    initialActionState,
  );
  const [routeUpdateState, updateRouteFormAction] = useActionState(
    actions.updateRouteAction,
    initialActionState,
  );
  const [routeDeleteState, deleteRouteFormAction] = useActionState(
    actions.deleteRouteAction,
    initialActionState,
  );
  const [feeHeadCreateState, createFeeHeadFormAction] = useActionState(
    actions.createFeeHeadAction,
    initialActionState,
  );
  const [feeHeadUpdateState, updateFeeHeadFormAction] = useActionState(
    actions.updateFeeHeadAction,
    initialActionState,
  );
  const [feeHeadDeleteState, deleteFeeHeadFormAction] = useActionState(
    actions.deleteFeeHeadAction,
    initialActionState,
  );
  const [paymentModeState, setPaymentModeFormAction] = useActionState(
    actions.setPaymentModeActiveAction,
    initialActionState,
  );
  // Every list on this page saves through its own action; without this none of
  // them said anything or refreshed, so a created class simply did not appear.
  useActionFeedbackMany(
    [
      sessionCreateState,
      sessionUpdateState,
      sessionDeleteState,
      setLiveSessionState,
      classCreateState,
      classUpdateState,
      classDeleteState,
      routeCreateState,
      routeUpdateState,
      routeDeleteState,
      feeHeadCreateState,
      feeHeadUpdateState,
      feeHeadDeleteState,
      paymentModeState,
    ],
    { successTitle: "Master data updated", errorTitle: "Master data not updated" },
  );

  const [classSearch, setClassSearch] = useState("");
  const [routeSearch, setRouteSearch] = useState("");

  const normalizedClassSearch = classSearch.trim().toLowerCase();
  const normalizedRouteSearch = routeSearch.trim().toLowerCase();
  const filteredClasses = normalizedClassSearch
    ? classes.filter((item) => {
        const searchHaystack = [
          item.session_label,
          item.class_name,
          item.section ?? "",
          item.stream_name ?? "",
          item.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return searchHaystack.includes(normalizedClassSearch);
      })
    : classes;
  const filteredRoutes = normalizedRouteSearch
    ? routes.filter((item) => {
        const searchHaystack = [
          item.route_code ?? "",
          item.route_name,
          item.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return searchHaystack.includes(normalizedRouteSearch);
      })
    : routes;

  return (
    <div className="space-y-8">
      {/* One row of jump links with their counts. This used to be a card of
          explanation plus five separate count boxes: a full phone screen before
          the first list. */}
      <nav aria-label="Lists on this page" className="snap-x-strip -mx-1 items-center gap-2 px-1 md:mx-0 md:flex md:flex-wrap md:px-0">
        {[
          ["sessions", "Sessions", sessions.length],
          ["classes", "Classes", classes.length],
          ["routes", "Routes", routes.length],
          ["fee-heads", "Fee heads", feeHeads.length],
          ["payment-modes", "Payment modes", paymentModes.length],
        ].map(([anchor, label, count]) => (
          <Button key={anchor} asChild variant="outline" size="sm" className="shrink-0 rounded-full">
            <a href={`#master-data-${anchor}`}>
              {label} <span className="text-muted-foreground">{count}</span>
            </a>
          </Button>
        ))}
      </nav>

      <section id="master-data-sessions" className="space-y-4 rounded-2xl border border-border bg-card p-4 scroll-mt-24">
        <h2 className="text-lg font-semibold text-foreground">Academic Sessions</h2>
        <ActionMessage state={sessionCreateState} />
        <ActionMessage state={sessionUpdateState} />
        <ActionMessage state={sessionDeleteState} />
        <ActionMessage state={setLiveSessionState} />

        <AddRow label="Add session">
          <form action={createSessionFormAction} className="grid gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <Label htmlFor="newSessionLabel">Session label</Label>
              <Input id="newSessionLabel" name="sessionLabel" placeholder="2026-27" className="mt-1" required />
            </div>
            <div>
              <Label>Status</Label>
              <SessionStatusSelect name="sessionStatus" value="active" />
            </div>
            <div className="md:col-span-5">
              <Label htmlFor="newSessionNotes">Notes</Label>
              <Input id="newSessionNotes" name="sessionNotes" className="mt-1" />
            </div>
            <PendingSubmitButton className="md:col-span-5 w-fit">Add session</PendingSubmitButton>
          </form>
        </AddRow>

        <div className="space-y-2">
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-sm text-muted-foreground">
              No academic sessions saved yet. Add the active session before configuring
              classes, fee defaults, or ledger generation.
            </div>
          ) : (
            sessions.map((session) => (
              <EditRow
                key={session.id}
                title={session.session_label}
                subtitle={`${STATUS_LABELS[session.status]}${session.notes ? ` · ${session.notes}` : ""}`}
                badge={
                  session.is_current ? (
                    <span className="rounded-md border border-success/30 bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-soft-foreground">
                      Live now
                    </span>
                  ) : null
                }
                editLabel="Edit"
              >
                <form action={updateSessionFormAction} className="grid gap-3 md:grid-cols-5">
                  <input type="hidden" name="sessionId" value={session.id} />
                  <div className="md:col-span-2">
                    <Label>Session label</Label>
                    <Input name="sessionLabel" defaultValue={session.session_label} className="mt-1" required />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <SessionStatusSelect name="sessionStatus" value={session.status} />
                  </div>
                  <div className="space-y-2">
                    <Label>Live app session</Label>
                    <input type="hidden" name="isCurrentSession" value={session.is_current ? "yes" : "no"} />
                    <span
                      className={
                        session.is_current
                          ? "inline-flex h-8 items-center rounded-md border border-success/30 bg-success-soft px-2.5 text-xs font-semibold text-success-soft-foreground"
                          : "inline-flex h-8 items-center rounded-md border border-border bg-surface-2 px-2.5 text-xs font-semibold text-muted-foreground"
                      }
                    >
                      {session.is_current ? "Live now" : "Not live"}
                    </span>
                  </div>
                  <div className="md:col-span-5">
                    <Label>Notes</Label>
                    <Input name="sessionNotes" defaultValue={session.notes ?? ""} className="mt-1" />
                  </div>
                  <div className="flex flex-wrap gap-2 md:col-span-5">
                    <PendingSubmitButton>Save session</PendingSubmitButton>
                  </div>
                </form>
                <form
                  action={deleteSessionFormAction}
                  className="mt-2"
                  onSubmit={(event) => {
                    // Audit 1.23 — destructive action needs a typed confirmation
                    // echoing the session label. Mirrors the live-switch UX.
                    const typed = window.prompt(
                      `Delete academic session "${session.session_label}"?\n\nThis is irreversible. Type the session label to confirm.`,
                    );
                    if (typed === null) {
                      event.preventDefault();
                      return;
                    }
                    if (typed.trim() !== session.session_label) {
                      event.preventDefault();
                      window.alert(
                        `Confirmation did not match "${session.session_label}". Session not deleted.`,
                      );
                    }
                  }}
                >
                  <input type="hidden" name="sessionId" value={session.id} />
                  <PendingSubmitButton variant="outline">Delete session</PendingSubmitButton>
                </form>
                {!session.is_current ? (
                  <form
                    action={setLiveSessionFormAction}
                    className="mt-2"
                    onSubmit={(event) => {
                      if (
                        !window.confirm(
                          `Switch the entire app to view ${session.session_label}? Staff currently posting payments will see ${session.session_label} on their next page load.`,
                        )
                      ) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="sessionLabel" value={session.session_label} />
                    <input type="hidden" name="confirmSessionLabel" value={session.session_label} />
                    <PendingSubmitButton variant="outline">Make this the live session</PendingSubmitButton>
                  </form>
                ) : null}
              </EditRow>
            ))
          )}
        </div>
      </section>

      <div className="grid gap-6 2xl:grid-cols-2">
        <section id="master-data-classes" className="space-y-4 rounded-2xl border border-border bg-card p-4 scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Classes</h2>
            <p className="text-sm text-muted-foreground">
              Tap a class to change or delete it.
            </p>
          </div>
          <div className="w-full max-w-sm">
            <Label htmlFor="class-search">Search classes</Label>
            <Input
              id="class-search"
              value={classSearch}
              onChange={(event) => setClassSearch(event.target.value)}
              placeholder="Class name, section, session"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Showing {filteredClasses.length} of {classes.length} classes
            </p>
          </div>
        </div>
        <ActionMessage state={classCreateState} />
        <ActionMessage state={classUpdateState} />
        <ActionMessage state={classDeleteState} />

        <AddRow label="Add class">
        <form action={createClassFormAction} className="grid gap-3 md:grid-cols-6">
          <div>
            <Label>Session</Label>
            <select name="sessionLabel" className={selectClassName} required>
              <option value="">Select session</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.session_label}>
                  {session.session_label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Class name</Label>
            <Input name="className" className="mt-1" required />
          </div>
          <div>
            <Label>Section</Label>
            <Input name="section" className="mt-1" />
          </div>
          <div>
            <Label>Stream</Label>
            <Input name="streamName" className="mt-1" />
          </div>
          <div>
            <Label>Sort order</Label>
            <Input name="sortOrder" type="number" min={0} defaultValue={0} className="mt-1" required />
          </div>
          <div>
            <Label>Status</Label>
            <SessionStatusSelect name="classStatus" value="active" />
          </div>
          <div className="md:col-span-6">
            <Label>Notes</Label>
            <Input name="classNotes" className="mt-1" />
          </div>
          <PendingSubmitButton className="md:col-span-6 w-fit">Add class</PendingSubmitButton>
        </form>
        </AddRow>

        <div className="space-y-2">
          {filteredClasses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-sm text-muted-foreground">
              No matching classes found. Clear the search or add a new class row.
            </div>
          ) : (
            filteredClasses.map((item) => (
              <EditRow
                key={item.id}
                title={[item.class_name, item.section, item.stream_name].filter(Boolean).join(" · ")}
                subtitle={`${item.session_label} · ${STATUS_LABELS[item.status]}`}
                editLabel="Edit"
              >
                <form action={updateClassFormAction} className="grid gap-3 md:grid-cols-6">
                  <input type="hidden" name="classId" value={item.id} />
                  <div>
                    <Label>Session</Label>
                    <select name="sessionLabel" defaultValue={item.session_label} className={selectClassName} required>
                      {sessions.map((session) => (
                        <option key={session.id} value={session.session_label}>
                          {session.session_label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Class name</Label>
                    <Input name="className" defaultValue={item.class_name} className="mt-1" required />
                  </div>
                  <div>
                    <Label>Section</Label>
                    <Input name="section" defaultValue={item.section ?? ""} className="mt-1" />
                  </div>
                  <div>
                    <Label>Stream</Label>
                    <Input name="streamName" defaultValue={item.stream_name ?? ""} className="mt-1" />
                  </div>
                  <div>
                    <Label>Sort order</Label>
                    <Input name="sortOrder" type="number" min={0} defaultValue={item.sort_order} className="mt-1" required />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <SessionStatusSelect name="classStatus" value={item.status} />
                  </div>
                  <div className="md:col-span-6">
                    <Label>Notes</Label>
                    <Input name="classNotes" defaultValue={item.notes ?? ""} className="mt-1" />
                  </div>
                  <div className="flex flex-wrap gap-2 md:col-span-6">
                    <PendingSubmitButton>Save class</PendingSubmitButton>
                    <PendingSubmitButton
                      variant="outline"
                      formAction={deleteClassFormAction}
                      onClick={confirmDelete(`the class ${item.class_name}`)}
                    >
                      Delete class
                    </PendingSubmitButton>
                  </div>
                </form>
              </EditRow>
            ))
          )}
        </div>
      </section>

        <section id="master-data-routes" className="space-y-4 rounded-2xl border border-border bg-card p-4 scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Transport Routes</h2>
            <p className="text-sm text-muted-foreground">
              Tap a route to change its fee or delete it.
            </p>
          </div>
          <div className="w-full max-w-sm">
            <Label htmlFor="route-search">Search routes</Label>
            <Input
              id="route-search"
              value={routeSearch}
              onChange={(event) => setRouteSearch(event.target.value)}
              placeholder="Route code or route name"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Showing {filteredRoutes.length} of {routes.length} routes
            </p>
          </div>
        </div>
        <ActionMessage state={routeCreateState} />
        <ActionMessage state={routeUpdateState} />
        <ActionMessage state={routeDeleteState} />

        <AddRow label="Add route">
        <form action={createRouteFormAction} className="grid gap-3 md:grid-cols-5">
          <div>
            <Label>Route code</Label>
            <Input name="routeCode" className="mt-1" />
          </div>
          <div>
            <Label>Route name</Label>
            <Input name="routeName" className="mt-1" required />
          </div>
          <div>
            <Label>Default installment amount</Label>
            <Input name="defaultInstallmentAmount" type="number" min={0} defaultValue={0} className="mt-1" required />
          </div>
          <div>
            <Label>Active</Label>
            <select name="routeIsActive" defaultValue="yes" className={selectClassName}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div>
            <Label>Notes</Label>
            <Input name="routeNotes" className="mt-1" />
          </div>
          <PendingSubmitButton className="md:col-span-5 w-fit">Add route</PendingSubmitButton>
        </form>
        </AddRow>

        <div className="space-y-2">
          {filteredRoutes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-sm text-muted-foreground">
              No matching routes found. Clear the search or add a new route row.
            </div>
          ) : (
            filteredRoutes.map((item) => (
              <EditRow
                key={item.id}
                title={item.route_name}
                subtitle={[
                  item.route_code,
                  `₹${item.default_installment_amount.toLocaleString("en-IN")} per installment`,
                  item.is_active ? null : "Inactive",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                editLabel="Edit"
              >
                <form action={updateRouteFormAction} className="grid gap-3 md:grid-cols-5">
                  <input type="hidden" name="routeId" value={item.id} />
                  <div>
                    <Label>Route code</Label>
                    <Input name="routeCode" defaultValue={item.route_code ?? ""} className="mt-1" />
                  </div>
                  <div>
                    <Label>Route name</Label>
                    <Input name="routeName" defaultValue={item.route_name} className="mt-1" required />
                  </div>
                  <div>
                    <Label>Default installment amount</Label>
                    <Input
                      name="defaultInstallmentAmount"
                      type="number"
                      min={0}
                      defaultValue={item.default_installment_amount}
                      className="mt-1"
                      required
                    />
                  </div>
                  <div>
                    <Label>Active</Label>
                    <select
                      name="routeIsActive"
                      defaultValue={item.is_active ? "yes" : "no"}
                      className={selectClassName}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Input name="routeNotes" defaultValue={item.notes ?? ""} className="mt-1" />
                  </div>
                  <div className="flex flex-wrap gap-2 md:col-span-5">
                    <PendingSubmitButton>Save route</PendingSubmitButton>
                    <PendingSubmitButton
                      variant="outline"
                      formAction={deleteRouteFormAction}
                      onClick={confirmDelete(`the route ${item.route_name}`)}
                    >
                      Delete route
                    </PendingSubmitButton>
                  </div>
                </form>
              </EditRow>
            ))
          )}
        </div>
      </section>
      </div>

      <div className="grid gap-6 2xl:grid-cols-2">
        <section id="master-data-fee-heads" className="space-y-4 rounded-2xl border border-border bg-card p-4 scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Custom fee heads</h2>
            <p className="text-sm text-muted-foreground">
              Extra named fees beyond tuition, transport and books. Set their amounts in Fee setup.
            </p>
          </div>
        </div>

        <ActionMessage state={feeHeadCreateState} />
        <ActionMessage state={feeHeadUpdateState} />
        <ActionMessage state={feeHeadDeleteState} />

        <AddRow label="Add fee head">
          <form action={createFeeHeadFormAction} className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Label htmlFor="feeHeadLabel">Fee head label</Label>
              <Input id="feeHeadLabel" name="feeHeadLabel" className="mt-1" placeholder="Lab fee" required />
            </div>
            <PendingSubmitButton className="w-fit">Add fee head</PendingSubmitButton>
          </form>
        </AddRow>

        {feeHeads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-sm text-muted-foreground">
            No custom fee heads are active right now. Add one above when the school needs an extra
            named fee type beyond tuition, transport, books, or admission/activity/misc.
          </div>
        ) : (
          <div className="space-y-2">
            {feeHeads.map((item) => (
              <EditRow
                key={item.id}
                title={item.label}
                subtitle={item.isActive ? "Active" : "Inactive"}
                editLabel="Edit"
              >
                <form action={updateFeeHeadFormAction} className="grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
                  <input type="hidden" name="feeHeadId" value={item.id} />
                  <div>
                    <Label>Fee head label</Label>
                    <Input name="feeHeadLabel" defaultValue={item.label} className="mt-1" required />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <select
                      name="feeHeadIsActive"
                      defaultValue={item.isActive ? "yes" : "no"}
                      className={selectClassName}
                    >
                      <option value="yes">Active</option>
                      <option value="no">Inactive</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <PendingSubmitButton>Save</PendingSubmitButton>
                  </div>
                </form>
                <form action={deleteFeeHeadFormAction} className="mt-2">
                  <input type="hidden" name="feeHeadId" value={item.id} />
                  <PendingSubmitButton variant="outline" onClick={confirmDelete(`the fee head ${item.label}`)}>
                    Delete
                  </PendingSubmitButton>
                </form>
              </EditRow>
            ))}
          </div>
        )}
      </section>

        <section id="master-data-payment-modes" className="space-y-4 rounded-2xl border border-border bg-card p-4 scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Accepted payment modes</h2>
            <p className="text-sm text-muted-foreground">
              Which ways of paying the fee desk accepts.
            </p>
          </div>
        </div>

        <ActionMessage state={paymentModeState} />

        <div className="space-y-2">
          {paymentModes.map((item) => (
            <form
              key={item.value}
              action={setPaymentModeFormAction}
              className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
            >
              <input type="hidden" name="paymentMode" value={item.value} />
              <input type="hidden" name="modeIsActive" value={item.isActive ? "no" : "yes"} />
              <div>
                <p className="font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.value}</p>
              </div>
              <PendingSubmitButton variant="outline">
                {item.isActive ? "Disable" : "Enable"}
              </PendingSubmitButton>
            </form>
          ))}
        </div>
      </section>
      </div>
    </div>
  );
}
