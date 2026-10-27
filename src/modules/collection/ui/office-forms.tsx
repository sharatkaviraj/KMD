"use client";

import { useActionState, useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";

import {
  createRequestAction,
  decideSubmissionsAction,
  queueMessageAction,
  saveFieldAction,
  saveTemplateAction,
  sendMessageAction,
  uploadDocumentAction,
} from "@/app/(app)/collection/actions";
import { m } from "@/messages";
import {
  fieldInputLabels,
  fieldInputs,
  fieldModeLabels,
  fieldModes,
  type CollectionField,
} from "@/modules/collection/domain/fields";
import { idleCollectionState, type CollectionState } from "@/modules/collection/domain/form-state";
import {
  messageAudienceLabels,
  messageAudiences,
  isGenericMessageTemplate,
  type MessageTemplate,
} from "@/modules/collection/domain/messages";
import { documentKindLabels, documentKinds } from "@/modules/collection/domain/review";
import { optionalHalf, requiredHalf } from "@/platform/i18n/authored";
import { primary } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Checkbox, Field, Input, Notice, Select, Textarea } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

import { DriveDocumentForm } from "./drive-document-form";

/** Build a request: a class, some questions, and who is being asked. */
export function NewRequestForm({
  classes,
  staff,
  fields,
}: {
  classes: { id: string; label: string }[];
  staff: { id: string; displayName: string }[];
  fields: CollectionField[];
}) {
  const language = useLanguage();
  const required = requiredHalf(language);
  const optional = optionalHalf(language);
  const [state, action, pending] = useActionState(
    createRequestAction,
    idleCollectionState,
  );

  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      {/* **One title, in the language the author thinks in.** Both halves were
          required, so a school that works in Hindi typed every title twice to
          buy a translation nobody asked for (B-05). The reader half is asked
          for; the other is offered. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={language === "en" ? m.name : m.languageHindi}
          htmlFor={`title-${required}`}
          hint={m.authoredTitleHint}
          language={language}
        >
          <Input
            id={`title-${required}`}
            name={required === "en" ? "titleEn" : "titleHi"}
            required
            maxLength={120}
          />
        </Field>
        <Field
          label={optional === "en" ? m.name : m.languageHindi}
          htmlFor={`title-${optional}`}
          hint={m.authoredOptional}
          language={language}
        >
          <Input
            id={`title-${optional}`}
            name={optional === "en" ? "titleEn" : "titleHi"}
            maxLength={120}
          />
        </Field>
      </div>

      <Field label={m.teachClassTitle} htmlFor="req-class" language={language}>
        <Select id="req-class" name="classId" required defaultValue="">
          <option value="">—</option>
          {classes.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={m.collectionAssignTo} htmlFor="req-staff" language={language}>
        <Select id="req-staff" name="assignedStaffId" defaultValue="">
          <option value="">—</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={m.collectionChooseFields} htmlFor="req-fields" language={language}>
        <div id="req-fields" className="space-y-1.5">
          {fields.map((field) => (
            <Checkbox
              key={field.id}
              id={`field-${field.id}`}
              name="fieldIds"
              value={field.id}
              label={{ hi: field.labelHi, en: field.labelEn }}
              language={language}
            />
          ))}
        </div>
      </Field>

      <Field label={m.collectionDueDate} htmlFor="req-due" language={language}>
        <Input id="req-due" name="dueDate" type="date" />
      </Field>

      <Field label={m.collectionReason} htmlFor="req-reason" language={language}>
        <Textarea
          id="req-reason"
          name="reasonEn"
          rows={2}
          maxLength={300}
          placeholder={primary(m.collectionReasonHint, language)}
        />
      </Field>
      <input type="hidden" name="reasonHi" value="" />

      <Button
        type="submit"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(m.collectionNew, language)}
      </Button>
    </form>
  );
}

/** One question in the registry. */
export function FieldForm({ field }: { field?: CollectionField }) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(saveFieldAction, idleCollectionState);
  const [inputType, setInputType] = useState(field?.inputType ?? "text");
  const id = field?.id ?? "new";

  return (
    <form action={action} className="space-y-3">
      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.name} htmlFor={`label-en-${id}`} language={language}>
          <Input
            id={`label-en-${id}`}
            name="labelEn"
            required
            maxLength={80}
            defaultValue={field?.labelEn ?? ""}
          />
        </Field>
        <Field label={m.languageHindi} htmlFor={`label-hi-${id}`} language={language}>
          <Input
            id={`label-hi-${id}`}
            name="labelHi"
            required
            maxLength={80}
            defaultValue={field?.labelHi ?? ""}
          />
        </Field>
      </div>

      {field ? (
        <>
          <input type="hidden" name="key" value={field.key} />
          <p className="text-[12px] text-subtle-foreground">
            {primary(m.collectionFieldKey, language)}:{" "}
            <span className="font-mono">{field.key}</span> ·{" "}
            {primary(m.collectionFieldKeyHint, language)}
          </p>
        </>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.collectionFieldType} htmlFor={`type-${id}`} language={language}>
          <Select
            id={`type-${id}`}
            name="inputType"
            value={inputType}
            onChange={(event) =>
              setInputType(event.target.value as CollectionField["inputType"])
            }
          >
            {fieldInputs.map((type) => (
              <option key={type} value={type}>
                {primary(fieldInputLabels[type], language)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={m.collectionFieldMode} htmlFor={`mode-${id}`} language={language}>
          <Select id={`mode-${id}`} name="mode" defaultValue={field?.mode ?? "confirm"}>
            {fieldModes.map((mode) => (
              <option key={mode} value={mode}>
                {primary(fieldModeLabels[mode], language)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {inputType === "select" ? (
        <Field
          label={m.collectionFieldOptions}
          htmlFor={`options-${id}`}
          language={language}
        >
          <Textarea
            id={`options-${id}`}
            name="optionsText"
            rows={3}
            placeholder={primary(m.collectionFieldOptionsHint, language)}
            defaultValue={(field?.options ?? []).join("\n")}
            onChange={(event) => {
              // Each line becomes its own `options` entry, because the action
              // reads a repeated field rather than parsing a blob.
              const form = event.target.form;
              if (!form) return;
              form
                .querySelectorAll('input[name="options"]')
                .forEach((node) => node.remove());
              for (const line of event.target.value.split("\n")) {
                const value = line.trim();
                if (!value) continue;
                const hidden = document.createElement("input");
                hidden.type = "hidden";
                hidden.name = "options";
                hidden.value = value;
                form.appendChild(hidden);
              }
            }}
          />
        </Field>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label={m.collectionFieldLength}
          htmlFor={`len-${id}`}
          language={language}
        >
          <Input
            id={`len-${id}`}
            name="exactLen"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            defaultValue={field?.exactLen ?? ""}
          />
        </Field>
        <Field label={m.collectionFieldMax} htmlFor={`max-${id}`} language={language}>
          <Input
            id={`max-${id}`}
            name="maxValue"
            type="number"
            inputMode="numeric"
            defaultValue={field?.maxValue ?? ""}
          />
        </Field>
        <Field label={m.sortOrder} htmlFor={`sort-${id}`} language={language}>
          <Input
            id={`sort-${id}`}
            name="sortOrder"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={field?.sortOrder ?? 0}
          />
        </Field>
      </div>

      <Field
        label={m.collectionFieldFeeColumn}
        htmlFor={`fee-${id}`}
        language={language}
      >
        <Input
          id={`fee-${id}`}
          name="feeColumn"
          maxLength={60}
          defaultValue={field?.feeColumn ?? ""}
        />
      </Field>
      <p className="-mt-1 text-[12px] text-subtle-foreground">
        {primary(m.collectionFieldFeeColumnHint, language)}
      </p>

      <Field label={m.collectionFieldHelp} htmlFor={`help-${id}`} language={language}>
        <Input
          id={`help-${id}`}
          name="helpEn"
          maxLength={200}
          defaultValue={field?.helpEn ?? ""}
        />
      </Field>
      <input type="hidden" name="helpHi" value={field?.helpHi ?? ""} />

      <Button
        type="submit"
        variant="outline"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(state.status === "saved" ? m.saved : m.save, language)}
      </Button>
    </form>
  );
}

/**
 * Accept or reject a batch of answers.
 *
 * The command id is minted here and kept until an answer comes back, so a
 * press whose response was lost is asked about again with the same id — the
 * database returns what it already did instead of deciding twice (P10).
 */
export function DecideForm({
  submissionIds,
  accept,
  label,
  variant = "primary",
  replaceNewer = false,
}: {
  submissionIds: string[];
  accept: boolean;
  label: typeof m.reviewAccept;
  variant?: "primary" | "outline";
  /** Accept even though the record moved after the answer — offered only where it did. */
  replaceNewer?: boolean;
}) {
  const language = useLanguage();
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(
    async (previous: CollectionState, formData: FormData) => {
      const result = await decideSubmissionsAction(previous, formData);
      setCommandId(crypto.randomUUID());
      return result;
    },
    idleCollectionState,
  );

  return (
    <form action={action} className="space-y-2" data-decide={accept ? (replaceNewer ? "replace" : "accept") : "reject"}>
      {submissionIds.map((id) => (
        <input key={id} type="hidden" name="submissionIds" value={id} />
      ))}
      <input type="hidden" name="accept" value={accept ? "true" : "false"} />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="replaceNewer" value={replaceNewer ? "true" : "false"} />

      {state.message ? (
        <Notice tone={state.status === "error" ? "warning" : "success"} text={state.message} language={language} />
      ) : null}

      <Button
        type="submit"
        variant={variant}
        size="sm"
        loading={pending}
        loadingText={primary(m.saving, language)}
        disabled={submissionIds.length === 0}
      >
        {primary(label, language)}
        {submissionIds.length > 1 ? ` (${submissionIds.length})` : ""}
      </Button>
    </form>
  );
}

/** Copy a link, without asking anybody to select sixteen characters by hand. */
export function CopyLink({ url }: { url: string }) {
  const language = useLanguage();
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-xl border border-border bg-surface-2 px-3 py-2 text-[12px]">
        {url}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard access can be refused. The link is on screen either
            // way, which is why it is rendered rather than hidden behind this.
          }
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {primary(copied ? m.collectionCopied : m.collectionCopyLink, language)}
      </Button>
    </div>
  );
}

/**
 * Upload one document about one child. `mode` is decided on the server from
 * `file_storage_settings` (D-333): the Supabase bucket by default, the
 * school's Shared Drive once it is switched on for this person.
 */
export function DocumentForm({ studentId, mode = "supabase" }: { studentId: string; mode?: "supabase" | "gdrive" }) {
  if (mode === "gdrive") return <DriveDocumentForm studentId={studentId} />;
  return <BucketDocumentForm studentId={studentId} />;
}

function BucketDocumentForm({ studentId }: { studentId: string }) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(
    uploadDocumentAction,
    idleCollectionState,
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="studentId" value={studentId} />

      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <Field label={m.documentsKind} htmlFor="doc-kind" language={language}>
        <Select id="doc-kind" name="kind" defaultValue="other">
          {documentKinds.map((kind) => (
            <option key={kind} value={kind}>
              {primary(documentKindLabels[kind], language)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={m.documentsFile} htmlFor="doc-file" language={language}>
        <input
          id="doc-file"
          name="file"
          type="file"
          required
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="focus-ring w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-[13px] file:font-semibold"
        />
      </Field>

      <Field label={m.documentsNote} htmlFor="doc-note" language={language}>
        <Input id="doc-note" name="note" maxLength={200} />
      </Field>

      <p className="text-[12px] text-subtle-foreground">
        {primary(m.documentsLimit, language)}
      </p>

      <Button
        type="submit"
        variant="outline"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(m.documentsAdd, language)}
      </Button>
    </form>
  );
}

/** One WhatsApp template. */
export function TemplateForm({ template }: { template?: MessageTemplate }) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(
    saveTemplateAction,
    idleCollectionState,
  );
  const id = template?.id ?? "new";

  return (
    <form action={action} className="space-y-3">
      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <Field
        label={m.messagesTemplateCode}
        htmlFor={`code-${id}`}
        language={language}
      >
        <Input
          id={`code-${id}`}
          name="code"
          required
          maxLength={80}
          defaultValue={template?.code ?? ""}
          readOnly={Boolean(template)}
          className={template ? "font-mono" : undefined}
        />
      </Field>
      <p className="-mt-1 text-[12px] text-subtle-foreground">
        {primary(m.messagesTemplateCodeHint, language)}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.name} htmlFor={`tl-en-${id}`} language={language}>
          <Input
            id={`tl-en-${id}`}
            name="labelEn"
            required
            maxLength={80}
            defaultValue={template?.labelEn ?? ""}
          />
        </Field>
        <Field label={m.languageHindi} htmlFor={`tl-hi-${id}`} language={language}>
          <Input
            id={`tl-hi-${id}`}
            name="labelHi"
            required
            maxLength={80}
            defaultValue={template?.labelHi ?? ""}
          />
        </Field>
      </div>

      <Field label={m.messagesBody} htmlFor={`body-en-${id}`} language={language}>
        <Textarea
          id={`body-en-${id}`}
          name="bodyEn"
          required
          rows={3}
          maxLength={1024}
          defaultValue={template?.bodyEn ?? ""}
        />
      </Field>
      <Field label={m.languageHindi} htmlFor={`body-hi-${id}`} language={language}>
        <Textarea
          id={`body-hi-${id}`}
          name="bodyHi"
          required
          rows={3}
          maxLength={1024}
          defaultValue={template?.bodyHi ?? ""}
        />
      </Field>
      <p className="-mt-1 text-[12px] text-subtle-foreground">
        {primary(m.messagesBodyHint, language)}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={m.messagesAudience}
          htmlFor={`aud-${id}`}
          language={language}
        >
          <Select
            id={`aud-${id}`}
            name="audience"
            defaultValue={template?.audience ?? "staff"}
          >
            {messageAudiences.map((audience) => (
              <option key={audience} value={audience}>
                {primary(messageAudienceLabels[audience], language)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={m.sortOrder} htmlFor={`ts-${id}`} language={language}>
          <Input
            id={`ts-${id}`}
            name="sortOrder"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={template?.sortOrder ?? 0}
          />
        </Field>
      </div>

      <Checkbox
        id={`btn-${id}`}
        name="hasUrlButton"
        defaultChecked={template?.hasUrlButton ?? false}
        label={m.messagesHasButton}
        language={language}
      />

      <Button
        type="submit"
        variant="outline"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(state.status === "saved" ? m.saved : m.save, language)}
      </Button>
    </form>
  );
}

/** Put one message in the queue. */
export function QueueMessageForm({
  templates: allTemplates,
}: {
  templates: MessageTemplate[];
}) {
  const language = useLanguage();
  const templates = allTemplates.filter(isGenericMessageTemplate);
  const [state, action, pending] = useActionState(
    queueMessageAction,
    idleCollectionState,
  );
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const template = templates.find((entry) => entry.id === templateId);

  return (
    <form action={action} className="space-y-3">
      {state.status === "error" && state.message ? (
        <Notice tone="danger" text={state.message} language={language} />
      ) : null}

      <Field label={m.messagesTemplates} htmlFor="q-template" language={language}>
        <Select
          id="q-template"
          name="templateId"
          required
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
        >
          <option value="">—</option>
          {templates.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {language === "en" ? entry.labelEn : entry.labelHi}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.phone} htmlFor="q-phone" language={language}>
          <Input id="q-phone" name="toPhone" inputMode="numeric" required />
        </Field>
        <Field label={m.name} htmlFor="q-name" language={language}>
          <Input id="q-name" name="toName" maxLength={80} />
        </Field>
      </div>

      {(template?.variables ?? []).map((variable, index) => (
        <Field
          key={`${templateId}-${index}`}
          label={{ hi: variable, en: variable }}
          htmlFor={`q-var-${index}`}
          language={language}
        >
          <Input id={`q-var-${index}`} name="variables" maxLength={200} />
        </Field>
      ))}

      {template?.audience === "parent" ? (
        <Notice tone="warning" text={m.messagesParentRule} language={language} />
      ) : null}

      <Button
        type="submit"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(m.messagesQueue, language)}
      </Button>
    </form>
  );
}

/** Hand one queued message to the provider — or be told why not. */
export function SendButton({ id }: { id: string }) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(
    sendMessageAction,
    idleCollectionState,
  );

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />

      {state.status === "error" && state.message ? (
        <Notice tone="warning" text={state.message} language={language} />
      ) : null}

      <Button
        type="submit"
        variant="outline"
        size="sm"
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        <MessageCircle aria-hidden />
        {primary(m.linkSaveAll, language)}
      </Button>
    </form>
  );
}
