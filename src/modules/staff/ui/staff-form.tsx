"use client";

import { useActionState } from "react";
import Link from "@/ui/link";

import type { StaffFormState } from "@/app/(app)/staff/actions";
import * as m from "@/messages/pairs";
import { roleLabel, type StaffRole } from "@/platform/auth/permissions";
import { flat, primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import type { StaffProfile } from "@/modules/staff/domain/staff";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { Checkbox, Field, Input, Notice, Select } from "@/ui/primitives";

const initialState: StaffFormState = {
  status: "idle",
  fieldErrors: {},
  message: null,
};

type Action = (
  state: StaffFormState,
  formData: FormData,
) => Promise<StaffFormState>;

export function StaffForm({
  action,
  staff,
  cancelHref,
  roles,
}: {
  action: Action;
  /** Absent when creating. */
  staff?: StaffProfile;
  cancelHref: string;
  /**
   * The roles this person may choose (D-205). An administrator gets all
   * eight; anybody else creates teachers and viewers, and sees an existing
   * profile's role without being able to change it.
   */
  roles: readonly StaffRole[];
}) {
  const language = useLanguage();
  const [state, formAction, isPending] = useActionState<StaffFormState, FormData>(
    action,
    initialState,
  );
  const editing = Boolean(staff);
  const error = (field: string): Localized | null =>
    state.fieldErrors[field] ?? null;

  return (
    <form action={formAction} className="space-y-5">
      {staff ? <input type="hidden" name="id" value={staff.id} /> : null}

      {state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <Field
        label={m.name}
        htmlFor="displayName"
        error={error("displayName")}
        language={language}
      >
        <Input
          id="displayName"
          name="displayName"
          defaultValue={staff?.displayName}
          required
          autoComplete="off"
          placeholder={primary(m.fullName, language)}
          aria-invalid={Boolean(error("displayName")) || undefined}
        />
      </Field>

      <Field
        label={m.shortName}
        htmlFor="shortName"
        error={error("shortName")}
        language={language}
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
          {flat(editing ? m.shortNameLockedHint : m.shortNameNewHint, language)}
        </p>
      </Field>

      <Field label={m.role} htmlFor="role" error={error("role")} language={language}>
        <Select
          id="role"
          name="role"
          defaultValue={staff?.role ?? roles[0] ?? "teacher"}
          aria-invalid={Boolean(error("role")) || undefined}
          aria-describedby={roles.length === 1 ? "role-help" : undefined}
        >
          {roles.map((role) => (
            <option key={role} value={role}>
              {flat(roleLabel(role), language)}
            </option>
          ))}
        </Select>
        {roles.length === 1 ? (
          <p id="role-help" className="text-[13px] leading-5 text-muted-foreground">
            {flat(m.roleAdminOnlyHint, language)}
          </p>
        ) : null}
      </Field>

      <Checkbox
        id="isTeaching"
        name="isTeaching"
        defaultChecked={staff?.isTeaching ?? true}
        label={m.teaches}
        language={language}
      />

      <Field label={m.phone} htmlFor="phone" error={error("phone")} language={language}>
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
        label={m.whatsapp}
        htmlFor="whatsappPhone"
        error={error("whatsappPhone")}
        language={language}
      >
        <Input
          id="whatsappPhone"
          name="whatsappPhone"
          type="tel"
          inputMode="numeric"
          defaultValue={staff?.whatsappPhone ?? ""}
          autoComplete="off"
          placeholder={primary(m.whatsappHint, language)}
          aria-invalid={Boolean(error("whatsappPhone")) || undefined}
        />
      </Field>

      {/* The field this whole change exists for: each staff member reads the
          app in their own language, and this is where an admin sets it. */}
      <Field label={m.language} htmlFor="preferredLanguage" language={language}>
        <Select
          id="preferredLanguage"
          name="preferredLanguage"
          defaultValue={staff?.language ?? "hi"}
          aria-describedby="preferredLanguage-help"
        >
          <option value="hi">{flat(m.languageHindi, language)}</option>
          <option value="en">{flat(m.languageEnglish, language)}</option>
          <option value="both">{flat(m.languageBoth, language)}</option>
        </Select>
        <p
          id="preferredLanguage-help"
          className="text-[13px] leading-5 text-muted-foreground"
        >
          {flat(m.languageHint, language)}
        </p>
      </Field>

      <div className="flex gap-3 pt-1">
        <Link href={cancelHref} className={buttonClasses({ variant: "outline" })}>
          {primary(m.cancel, language)}
        </Link>
        <Button
          type="submit"
          loading={isPending}
          loadingText={primary(m.saving, language)}
          fullWidth
        >
          {primary(editing ? m.save : m.add, language)}
        </Button>
      </div>
    </form>
  );
}
