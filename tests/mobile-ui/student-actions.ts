import { p, type Pair } from "@/vx/text";
// Server actions Student 360 imports, refused in the synthetic browser fixture.
type Result = { ok: true; id?: string } | { ok: false; error: Pair };
const refuse = async (..._args: unknown[]): Promise<Result> => ({ ok: false, error: p("Synthetic action refused", "परीक्षण में कार्य रोका गया") });
export const logFamilyContactAction = refuse;
export const setNoteStatusAction = refuse;
export const replyToNoteAction = refuse;
