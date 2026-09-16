"use client";

import { useActionState } from "react";
import Link from "next/link";

import { staffRoles } from "@/platform/auth/permissions";
import { roleLabels, roleLabelsEn } from "@/platform/auth/permissions";
import type { StaffFormState } from "@/app/(app)/staff/actions";
import type { StaffProfile } from "@/modules/staff/domain/staff";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { Checkbox, Field, Input, Notice, Select } from "@/ui/primitives";

const initialState: StaffFormState = {
  status: "idle",
  fieldErrors: {},
  message: null,
  messageEn: null,
};

type Action = (
  state: StaffFormState,
  formData: FormData,
) => Promise<StaffFormState>;

export function StaffForm({
  action,
  staff,
  cancelHref,
}: {
  action: Action;
  /** Absent when creating. */
  staff?: StaffProfile;
  cancelHref: string;
}) {
  const [state, formAction, isPending] = useActionState<StaffFormState, FormData>(
    action,
    initialState,
  );
  const editing = Boolean(staff);
  const error = (field: string) => state.fieldErrors[field] ?? null;

  return (
    <form action={formAction} className="space-y-5">
      {staff ? <input type="hidden" name="id" value={staff.id} /> : null}

      {state.message ? (
        <Notice tone="danger" hi={state.message} en={state.messageEn ?? undefined} />
      ) : null}

      <Field label="नाम" hint="Name" htmlFor="displayName" error={error("displayName")}>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={staff?.displayName}
          required
          autoComplete="off"
          placeholder="पूरा नाम"
          aria-invalid={Boolean(error("displayName")) || undefined}
        />
      </Field>

      <Field
        label="संक्षिप्त नाम"
        hint="Short name"
        htmlFor="shortName"
        error={error("shortName")}
      >
        <Input
          id="shortName"
          name="shortName"
          defaultValue={staff?.shortName}
          required={!editing}
          // Immutable once written: it is the timetable's join key, and a
          // rename orphans every slot that named it. Enforced by a database
          // trigger too — this only stops the edit being offered.
          readOnly={editing}
          disabled={editing}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="RKS"
          maxLength={8}
          className="font-mono uppercase"
          aria-invalid={Boolean(error("shortName")) || undefined}
          aria-describedby="shortName-help"
        />
        <p id="shortName-help" className="text-[13px] leading-5 text-muted-foreground">
          {editing
            ? "यह बदला नहीं जा सकता — समय-सारिणी इसी से जुड़ती है। · Cannot be changed; the timetable joins on it."
            : "समय-सारिणी में इसी नाम से पहचान होगी। बाद में बदला नहीं जा सकता। · This is how the timetable will name them. It cannot be changed later."}
        </p>
      </Field>

      <Field label="भूमिका" hint="Role" htmlFor="role" error={error("role")}>
        <Select
          id="role"
          name="role"
          defaultValue={staff?.role ?? "teacher"}
          aria-invalid={Boolean(error("role")) || undefined}
        >
          {staffRoles.map((role) => (
            <option key={role} value={role}>
              {roleLabels[role]} · {roleLabelsEn[role]}
            </option>
          ))}
        </Select>
      </Field>

      <Checkbox
        id="isTeaching"
        name="isTeaching"
        defaultChecked={staff?.isTeaching ?? true}
        label="कक्षा लेते हैं"
        hint="Teaches classes"
      />

      <Field label="फ़ोन" hint="Phone" htmlFor="phone" error={error("phone")}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          defaultValue={staff?.phone ?? ""}
          autoComplete="off"
          placeholder="9876543210"
          aria-invalid={Boolean(error("phone")) || undefined}
        />
      </Field>

      <Field
        label="व्हाट्सएप"
        hint="WhatsApp"
        htmlFor="whatsappPhone"
        error={error("whatsappPhone")}
      >
        <Input
          id="whatsappPhone"
          name="whatsappPhone"
          type="tel"
          inputMode="numeric"
          defaultValue={staff?.whatsappPhone ?? ""}
          autoComplete="off"
          placeholder="अलग हो तो भरें · Only if different"
          aria-invalid={Boolean(error("whatsappPhone")) || undefined}
        />
      </Field>

      <Field label="भाषा" hint="Language" htmlFor="preferredLanguage">
        <Select
          id="preferredLanguage"
          name="preferredLanguage"
          defaultValue={staff?.preferredLanguage ?? "hi"}
        >
          <option value="hi">हिन्दी · Hindi</option>
          <option value="en">English</option>
        </Select>
      </Field>

      <div className="flex gap-3 pt-1">
        <Link href={cancelHref} className={buttonClasses({ variant: "outline" })}>
          रद्द करें
        </Link>
        <Button type="submit" loading={isPending} loadingText="सहेजा जा रहा है…" fullWidth>
          {editing ? "बदलाव सहेजें" : "जोड़ें"}
        </Button>
      </div>
    </form>
  );
}
