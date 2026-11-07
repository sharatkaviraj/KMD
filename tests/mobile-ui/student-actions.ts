import { p, type Pair } from "@/vx/text";
// Server actions Student 360 imports, refused in the synthetic browser fixture.
type Result = { ok: true; id?: string } | { ok: false; error: Pair };
const refuse = async (..._args: unknown[]): Promise<Result> => ({ ok: false, error: p("Synthetic action refused", "परीक्षण में कार्य रोका गया") });
export const logFamilyContactAction = refuse;
export const checkFamilyContactAction = refuse;
export const setNoteStatusAction = refuse;
export const replyToNoteAction = refuse;
// The rest of the notes actions, for the notes screens in the design fixture.
export const createNoteAction = refuse;
export const undoNoteAction = refuse;
export const setFollowUpAction = refuse;
export const tellParentsAboutNoteAction = refuse;
export const createPlanAction = refuse;
export const addPlanStepAction = refuse;
export const togglePlanStepAction = refuse;
export const removePlanStepAction = refuse;
export const closePlanAction = refuse;
export const tellParentsAboutPlanAction = refuse;

// Added for the 21 Oct smoke fixes: this fixture never exercises it.
export const decideLeaveAction = refuse;
export const removeStudentDocument = refuse;
// The timetable screen's other actions, so a design view that bundles it still loads.
export const coverAction = refuse;
export const checkCoverAction = refuse;
export const lateCoverAction = refuse;
export const discardChangeAction = refuse;
export const publishChangesAction = refuse;
export const requestLeaveAction = refuse;
export const saveChangeAction = refuse;
