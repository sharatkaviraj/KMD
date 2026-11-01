import "server-only";
import * as XLSX from "xlsx";
import { returnTable, type GovernmentAdapter, type ReturnStudent } from "../domain/exchange";

export const MAX_RETURN_FILE_BYTES = 750 * 1024;
export const MAX_RETURN_ROWS = 2000;

/** Bound ZIP metadata before SheetJS expands a workbook. ZIP64/macros are unsupported. */
function checkWorkbookArchive(bytes: Uint8Array) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("Expected an XLSX workbook");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("Invalid workbook archive");
  const entries = view.getUint16(end + 10, true); let offset = view.getUint32(end + 16, true), total = 0;
  if (entries > 300) throw new Error("Workbook is too complex");
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Invalid workbook directory");
    const expanded = view.getUint32(offset + 24, true), size = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + size));
    total += expanded;
    if (expanded > 10 * 1024 * 1024 || total > 20 * 1024 * 1024 || /vba|\.bin$/i.test(name)) throw new Error("Oversized or macro workbook is unsupported");
    offset += 46 + size + extra + comment;
  }
}

export function renderReturnFile(rows: ReturnStudent[], adapter: GovernmentAdapter): { bytes: Uint8Array; fileName: string; contentType: string } {
  const table = returnTable(rows, adapter);
  const prefix = adapter.mode === "manual_reference" ? "manual-reference" : "verified-upload";
  const name = `${prefix}-${adapter.portal}-${adapter.sessionLabel}`;
  if (adapter.format === "csv") {
    const text = "\uFEFF" + table.map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";
    return { bytes: new TextEncoder().encode(text), fileName: `${name}.csv`, contentType: "text/csv" };
  }
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(table);
  for (const [key, value] of Object.entries(sheet)) if (!key.startsWith("!") && value && typeof value === "object" && "v" in value) { value.t = "s"; value.z = "@"; }
  sheet["!cols"] = adapter.columns.map((column) => ({ wch: column.field === "studentName" ? 35 : column.field === "studentId" ? 38 : 23 }));
  XLSX.utils.book_append_sheet(book, sheet, adapter.sheetName);
  if (adapter.mode === "manual_reference") XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["FOR MANUAL PORTAL ENTRY - NOT AN OFFICIAL UPLOAD FILE"], ["Destination", adapter.portal], ["Module", adapter.module], ["Session", adapter.sessionLabel], ["Rows", String(rows.length)], ["School code", adapter.schoolCode], ["Do not treat a download as portal submission or acceptance."]]), "Read first");
  return { bytes: new Uint8Array(XLSX.write(book, { bookType: "xlsx", type: "array", compression: true })), fileName: `${name}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}

function readReturnTable(bytes: Uint8Array, fileName: string, adapter: Pick<GovernmentAdapter, "format" | "sheetName">): string[][] {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RETURN_FILE_BYTES) throw new Error("Use a file of 750 KB or smaller");
  const extension = fileName.toLowerCase().split(".").at(-1);
  if (extension !== adapter.format) throw new Error("The file type does not match the verified adapter");
  if (extension === "xlsx") checkWorkbookArchive(bytes);
  const book = XLSX.read(bytes, { type: "array", raw: true, cellFormula: true, cellDates: false, sheetRows: MAX_RETURN_ROWS + 2, bookVBA: false });
  if (book.SheetNames.length !== 1) throw new Error("This adapter supports one flat worksheet only");
  if (adapter.format === "xlsx" && book.SheetNames[0] !== adapter.sheetName) throw new Error("Worksheet name differs from the verified specimen");
  const sheet = book.Sheets[book.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
  if (range.e.r > MAX_RETURN_ROWS || range.e.c >= 30) throw new Error("The worksheet exceeds the supported row or column limit");
  for (const [key, cell] of Object.entries(sheet)) {
    if (key.startsWith("!") || !cell || typeof cell !== "object") continue;
    if ("f" in cell || "F" in cell) throw new Error("Formula cells are not supported");
    // An Excel numeric ID has already lost its leading zeros. Refuse it;
    // never guess which string the operator intended from its display format.
    if (cell.t === "n" && key.replace(/\D/g, "") !== "1") throw new Error("Identifiers and values must be text cells");
  }
  const table = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false });
  return table.map((row) => row.map(String));
}
export function inspectReturnSpecimen(bytes: Uint8Array, fileName: string, format: "csv" | "xlsx", sheetName: string): string[] {
  const headers = readReturnTable(bytes, fileName, { format, sheetName })[0] ?? [];
  if (headers.length < 3 || headers.length > 30 || headers.some(h => !h.trim()) || new Set(headers).size !== headers.length) throw new Error("The specimen needs one flat header row with unique columns");
  return headers;
}
export function parseReturnFile(bytes: Uint8Array, fileName: string, adapter: GovernmentAdapter): Record<string, string>[] {
  const table = readReturnTable(bytes, fileName, adapter), headers = table[0] ?? [];
  if (!headers.length || new Set(headers).size !== headers.length || table.length < 2) throw new Error("The file has no usable rows or has duplicate headers");
  return table.slice(1).map((row) => Object.fromEntries(headers.map((header, i) => [header, String(row[i] ?? "")])));
}
