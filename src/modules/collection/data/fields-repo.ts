import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import type {
  CollectionField,
  FieldInputValue,
} from "@/modules/collection/domain/fields";

type FieldRow = {
  id: string;
  key: string;
  label_hi: string;
  label_en: string;
  input_type: CollectionField["inputType"];
  mode: CollectionField["mode"];
  exact_len: number | null;
  pattern: string | null;
  max_value: number | string | null;
  options: string[] | null;
  fee_column: string | null;
  help_hi: string | null;
  help_en: string | null;
  is_active: boolean;
  sort_order: number;
};

const COLUMNS =
  "id, key, label_hi, label_en, input_type, mode, exact_len, pattern, max_value, " +
  "options, fee_column, help_hi, help_en, is_active, sort_order";

export const toField = (row: FieldRow): CollectionField => ({
  id: row.id,
  key: row.key,
  labelHi: row.label_hi,
  labelEn: row.label_en,
  inputType: row.input_type,
  mode: row.mode,
  exactLen: row.exact_len,
  pattern: row.pattern,
  // `numeric` comes back as a string from PostgREST, and a string compared
  // with `>` against a number is a silently wrong validation.
  maxValue: row.max_value === null ? null : Number(row.max_value),
  options: row.options,
  feeColumn: row.fee_column,
  helpHi: row.help_hi,
  helpEn: row.help_en,
  isActive: row.is_active,
  sortOrder: row.sort_order,
});

export async function listFields(): Promise<CollectionField[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collection_fields")
    .select(COLUMNS)
    .order("sort_order")
    .returns<FieldRow[]>();

  if (error) throw new Error(`Could not read the fields: ${error.message}`);
  return data.map(toField);
}

/**
 * The same read, without a session.
 *
 * The public token pages have no signed-in user, so RLS would return nothing.
 * The token is the authorization and it has already been resolved by the time
 * this is called.
 */
export async function listFieldsPublic(): Promise<CollectionField[]> {
  const { data, error } = await createAdminClient()
    .from("collection_fields")
    .select(COLUMNS)
    .order("sort_order")
    .returns<FieldRow[]>();

  if (error) throw new Error(`Could not read the fields: ${error.message}`);
  return data.map(toField);
}

export async function upsertField(
  input: FieldInputValue,
  createdByUserId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("collection_fields")
    .upsert(
      {
        key: input.key,
        label_hi: input.labelHi,
        label_en: input.labelEn,
        input_type: input.inputType,
        mode: input.mode,
        exact_len: input.exactLen,
        max_value: input.maxValue,
        options: input.options,
        fee_column: input.feeColumn,
        help_hi: input.helpHi,
        help_en: input.helpEn,
        sort_order: input.sortOrder,
        created_by: createdByUserId,
      },
      { onConflict: "key" },
    );

  if (error) throw error;
}

/**
 * Retire a field rather than delete it.
 *
 * Submissions and student records point at it, and a question the school
 * stopped asking is still the question that was asked when those answers were
 * given. Deleting it would orphan them or, with `on delete restrict`, simply
 * fail — which is the database saying the same thing.
 */
export async function setFieldActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await createAdminClient()
    .from("collection_fields")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) throw error;
}
