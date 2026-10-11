import type { Cell } from "./domain/entry";
import type { SavePayload } from "./save-types";

/** Cell IDs/values and the exact command; never names, contacts or link tokens. */
export type MarksRecovery = { cells: Record<string, Cell>; command: SavePayload | null; revision: number; correctionReason?: string | null };

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function cell(value: unknown): value is Cell {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Cell>;
  return row.state === "value"
    ? typeof row.value === "number" && Number.isFinite(row.value) && row.value >= 0
    : ["blank", "absent", "exempt"].includes(row.state ?? "") && row.value === null;
}

export function isMarksRecovery(value: unknown): value is MarksRecovery {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<MarksRecovery>;
  if (!Number.isInteger(row.revision) || (row.revision ?? -1) < 0) return false;
  if (!(row.correctionReason === undefined || row.correctionReason === null || typeof row.correctionReason === "string")) return false;
  if (!row.cells || Array.isArray(row.cells) || typeof row.cells !== "object" || !Object.entries(row.cells).every(([id, entry]) => uuid(id) && cell(entry))) return false;
  if (row.command === null) return true;
  const command = row.command;
  if (!command || !uuid(command.commandId) || !uuid(command.paperId) || !["draft", "submit", "correction", "reopen"].includes(command.kind) || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 0 || !(command.reason === null || typeof command.reason === "string") || !Array.isArray(command.entries)) return false;
  const ids = new Set<string>();
  return command.entries.every((entry) => {
    if (!entry || !uuid(entry.studentId) || ids.has(entry.studentId) || !cell(entry)) return false;
    ids.add(entry.studentId);
    return true;
  });
}

export function commandCells(command: SavePayload): Record<string, Cell> {
  return Object.fromEntries(command.entries.map((entry) => [entry.studentId, { state: entry.state, value: entry.state === "value" ? entry.value : null }]));
}
