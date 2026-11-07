import type { BoardNote } from "../domain/notes";
import type { ChildChoice, NoteReply, NotesPeople, SupportPlan } from "../data";
import type { AddStep, ClientViewer } from "./parts";

export { NotesBoard } from "./board";
export { TeachNotes } from "./teacher";

/**
 * What the URL opens, decided on the server: `?note=` a note, `?note=&view=plan`
 * a new plan for it, `?plan=` a plan. One child's page is `scope`.
 */
export type NotesFocus =
  | { kind: "note"; note: BoardNote; replies: NoteReply[] }
  | { kind: "new-plan"; note: BoardNote }
  | { kind: "plan"; plan: SupportPlan }
  | null;

/**
 * `?student=` on the board: one child's page. It narrows what the reader
 * already sees and never widens it. `name` is null only when the reader may
 * not read the child's name; `sr`, `father` and `profile` (a link to Student
 * 360) only for a reader with `students:view`.
 */
export type NotesScope = {
  studentId: string;
  name: string | null;
  classLabel: string | null;
  classId?: string | null;
  sr?: string | null;
  father?: string | null;
  profile?: boolean;
  /** The child's photo when this reader may see it (the face at the top of "All notes"). */
  photo?: string | null;
} | null;

export type NotesProps = {
  notes: BoardNote[];
  plans: SupportPlan[];
  kids: ChildChoice[];
  viewer: ClientViewer;
  today: string;
  school: string;
  focus: NotesFocus;
  scope?: NotesScope;
  /** Class teachers, the coordinator and the admin, by name. */
  people?: NotesPeople;
  initialSheet: "add" | null;
  initialStep: AddStep;
  initialStudent: string | null;
  /** `?class=`: the class the composer opened from, so its picker starts there (B10). */
  initialClass?: string | null;
  /** `?saved=`: the note just saved, for the "Saved" states. */
  savedId?: string | null;
  /** The session is a TEST one: the saving line says so (U01). */
  testSession?: boolean;
};
