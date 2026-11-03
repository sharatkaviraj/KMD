#!/usr/bin/env node
/**
 * Are two exports the same shape? (plan Phase 5 §5.4; critique1 B5.)
 *
 *   node scripts/migrate/export-parity.mjs fees.xlsx one.xlsx
 *     --ignore-row-counts   compare names and headers only (two different
 *                           snapshots, or two different days)
 *     --json                print the comparison as JSON instead of lines
 *
 * Takes the same export downloaded from the fees app and from One — on the
 * same snapshot and session, per §5.4 — and compares, sheet by sheet:
 *   - the sheet names, and their order;
 *   - each sheet's column headers (its first non-empty row), and their order;
 *   - each sheet's data row count (non-empty rows after the header).
 *
 * It never prints a cell below the header row. A row count is a number; a
 * header is the export's own column name. Student names, phone numbers and
 * amounts stay in the files, which belong in %USERPROFILE%\.vppsone-migration\
 * and never in the repo (rule 6).
 *
 * The `ai-context-bundle` is the one that matters most: the owner's daily
 * `vpps-fee-list` skill reads `VPPSaicontextbundle*.xlsx` by sheet and column
 * name, so a renamed column there breaks it silently. Exit 1 on any
 * difference, so it can gate a rehearsal step.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import * as XLSX from "xlsx";

/** A cell's text, trimmed; empty for a blank. */
function cellText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

const isEmptyRow = (row) => !Array.isArray(row) || row.every((cell) => cellText(cell) === "");

/**
 * The shape of a workbook: per sheet, in workbook order, its headers and how
 * many data rows follow them. Nothing below the header row is kept.
 */
export function workbookShape(workbook) {
  return workbook.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      blankrows: false,
      defval: null,
      raw: true,
    });
    const headerIndex = rows.findIndex((row) => !isEmptyRow(row));
    if (headerIndex === -1) return { name, headers: [], rows: 0 };
    const headerRow = rows[headerIndex].map(cellText);
    // Trailing blank header cells are padding, not columns.
    while (headerRow.length && headerRow[headerRow.length - 1] === "") headerRow.pop();
    const dataRows = rows.slice(headerIndex + 1).filter((row) => !isEmptyRow(row)).length;
    return { name, headers: headerRow, rows: dataRows };
  });
}

export function readWorkbookShape(file) {
  return workbookShape(XLSX.read(readFileSync(file), { type: "buffer", cellDates: false }));
}

function orderDiffers(left, right) {
  const common = left.filter((item) => right.includes(item));
  const commonRight = right.filter((item) => left.includes(item));
  return common.some((item, index) => item !== commonRight[index]);
}

/**
 * Every way `right` differs from `left`, as data. `left` is the reference
 * (the fees app), `right` the copy (One).
 */
export function compareShapes(left, right, { ignoreRowCounts = false } = {}) {
  const leftNames = left.map((sheet) => sheet.name);
  const rightNames = right.map((sheet) => sheet.name);
  const byName = (shape) => new Map(shape.map((sheet) => [sheet.name, sheet]));
  const leftByName = byName(left);
  const rightByName = byName(right);

  const sheets = [];
  for (const name of leftNames) {
    const a = leftByName.get(name);
    const b = rightByName.get(name);
    if (!b) continue;
    const missingHeaders = a.headers.filter((header) => !b.headers.includes(header));
    const extraHeaders = b.headers.filter((header) => !a.headers.includes(header));
    const headerOrderDiffers = orderDiffers(a.headers, b.headers);
    const rowsDiffer = !ignoreRowCounts && a.rows !== b.rows;
    sheets.push({
      name,
      missingHeaders,
      extraHeaders,
      headerOrderDiffers,
      rows: { left: a.rows, right: b.rows },
      rowsDiffer,
      same: !missingHeaders.length && !extraHeaders.length && !headerOrderDiffers && !rowsDiffer,
    });
  }

  const missingSheets = leftNames.filter((name) => !rightByName.has(name));
  const extraSheets = rightNames.filter((name) => !leftByName.has(name));
  const sheetOrderDiffers = orderDiffers(leftNames, rightNames);
  return {
    missingSheets,
    extraSheets,
    sheetOrderDiffers,
    sheets,
    same:
      !missingSheets.length &&
      !extraSheets.length &&
      !sheetOrderDiffers &&
      sheets.every((sheet) => sheet.same),
  };
}

/** The comparison as lines a person reads. Headers and counts only. */
export function formatComparison(result, { leftLabel = "fees", rightLabel = "one" } = {}) {
  const lines = [];
  for (const name of result.missingSheets) lines.push(`MISSING sheet in ${rightLabel}: ${name}`);
  for (const name of result.extraSheets) lines.push(`EXTRA sheet in ${rightLabel}: ${name}`);
  if (result.sheetOrderDiffers) lines.push("ORDER sheets are in a different order");
  for (const sheet of result.sheets) {
    if (sheet.same) {
      lines.push(`OK    ${sheet.name} (${sheet.rows.right} rows)`);
      continue;
    }
    for (const header of sheet.missingHeaders) lines.push(`DIFF  ${sheet.name}: column missing in ${rightLabel}: ${header}`);
    for (const header of sheet.extraHeaders) lines.push(`DIFF  ${sheet.name}: extra column in ${rightLabel}: ${header}`);
    if (sheet.headerOrderDiffers) lines.push(`DIFF  ${sheet.name}: columns in a different order`);
    if (sheet.rowsDiffer) {
      lines.push(`DIFF  ${sheet.name}: rows ${leftLabel} ${sheet.rows.left} vs ${rightLabel} ${sheet.rows.right}`);
    }
  }
  lines.push(result.same ? "SAME shape" : "DIFFERENT shape");
  return lines;
}

function main(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const files = argv.filter((arg) => !arg.startsWith("--"));
  if (files.length !== 2) {
    process.stderr.write("usage: node scripts/migrate/export-parity.mjs <fees.xlsx> <one.xlsx> [--ignore-row-counts] [--json]\n");
    return 2;
  }
  const [leftFile, rightFile] = files;
  const result = compareShapes(readWorkbookShape(leftFile), readWorkbookShape(rightFile), {
    ignoreRowCounts: flags.has("--ignore-row-counts"),
  });
  if (flags.has("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${path.basename(leftFile)} vs ${path.basename(rightFile)}\n`);
    process.stdout.write(`${formatComparison(result).join("\n")}\n`);
  }
  return result.same ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
