#!/usr/bin/env node
/** Offline fixture generation. It never connects to One, Storage, or Gemini. */
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const classes = ["7B", "8A", "VI C", "IX A", "XI Science", "XII Arts", "5A", "10B"];
const givenEn = ["Avi", "Bela", "Charu", "Dev", "Esha", "Fiza", "Giri", "Hina", "Ira", "Jai", "Kavi", "Leela", "Mili", "Neel", "Omi", "Pari"];
const givenHi = ["अवि", "बेला", "चारु", "देव", "ईशा", "फ़िज़ा", "गिरि", "हीना", "इरा", "जय", "कवि", "लीला", "मिली", "नील", "ओमी", "परी"];
const surnamesEn = ["Sample", "Demo", "Example", "Practice"];
const surnamesHi = ["नमूना", "परीक्षण", "उदाहरण", "अभ्यास"];
const teachers = [
  ["QT", "क्यूटी"], ["RM", "आरएम"], ["SV", "एसवी"], ["JP", "जेपी"], ["LK", "एलके"], ["HB", "एचबी"],
  ["DX", "डीएक्स"], ["NY", "एनवाई"], ["WK", "डब्ल्यूके"], ["TR", "टीआर"], ["PQ", "पीक्यू"], ["BN", "बीएन"],
];
const subjects = ["Maths", "Hindi", "English", "Science", "Social Studies"];
const sizes = [12, 18, 24, 31, 40, 16, 28, 34, 20, 36, 13, 22, 29, 33, 38, 15, 25, 32, 37, 40];
const dev = (v) => String(v).replace(/\d/g, (d) => "०१२३४५६७८९"[Number(d)]);
const localDate = (i) => new Date(Date.UTC(2026, 9, 5 + i + 2 * Math.floor(i / 5))).toISOString().slice(0, 10);
const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4_294_967_296;
  };
}
function label(index, prefix) {
  return prefix + "-" + String(index + 1).padStart(2, "0");
}
function portions(rows, pages) {
  if (pages === 1) return [rows];
  const midpoint = Math.ceil(rows.length / 2);
  return [rows.slice(0, midpoint), rows.slice(midpoint)];
}

function marksCase(i) {
  const id = label(i, "marks");
  const classLabel = classes[i % classes.length];
  const subject = subjects[i % subjects.length];
  const maxMarks = [20, 40, 50, 80][i % 4];
  const language = i % 5;
  const chooseName = (j) => {
    const slot = (i * 3 + j) % givenEn.length;
    const group = (Math.floor(j / givenEn.length) + i) % surnamesEn.length;
    if (language === 2 || (language === 4 && j % 2 === 0)) return givenHi[slot] + " " + surnamesHi[group];
    if (language === 3 && j % 3 === 0) return givenEn[slot] + " " + surnamesHi[group];
    return givenEn[slot] + " " + surnamesEn[group];
  };
  const roster = Array.from({ length: sizes[i] + (i % 4 === 2 ? 2 : 0) }, (_, j) => ({
    ref: "R" + (j + 1), roll: String(j + 1), name: chooseName(j),
  }));
  if (i === 9) roster[6].name = roster[3].name;
  const rows = roster.slice(0, sizes[i]).map((entry, j) => {
    const n = ((i * 7 + j * 11) % maxMarks) + (j % 4 === 2 ? 0.5 : 0);
    let mark = String(n);
    if (j === 1 && i % 3 === 0) mark = "AB";
    if (j === 3 && i % 4 === 1) mark = "A";
    if (j === 5 && i % 4 === 2) mark = "–";
    if (j === 7 && i % 5 === 1) mark = "—";
    if (j === 8 && i % 5 === 2) mark = "";
    if (j === 9 && i % 5 === 3) mark = "0";
    if (j === 10 && i % 4 === 3) mark = String(maxMarks + 1);
    if (j === 11 && i % 4 === 1) mark = Math.floor(n) + "½";
    if (language >= 2 && j % 2 === 0) mark = dev(mark);
    const mismatch = i % 4 === 0 && j === 4;
    const writtenRoll = j < 9 && i % 5 === 0 ? entry.roll.padStart(2, "0") : entry.roll;
    const numeric = mark.replace(/[०-९]/gu, (digit) => String(digit.charCodeAt(0) - 0x966)).replace("½", ".5");
    return {
      roll: language >= 2 && j % 2 === 1 ? dev(writtenRoll) : writtenRoll,
      name: mismatch ? roster[j + 1].name : entry.name,
      marks: mark,
      parsedMarks: /^\d+(\.\d+)?$/.test(numeric) ? Number(numeric) : null,
      rosterRef: mismatch ? "" : entry.ref,
      unclear: i % 4 === 3 && j === 2,
    };
  });
  if (i === 11 || i === 16) rows.splice(6, 0, { ...rows[5] });
  const pages = portions(rows, [7, 10, 14, 19].includes(i) ? 2 : 1);
  return {
    sample: {
      id, action: "marks-photo", files: pages.map((_, p) => "marks/" + id + "-p" + (p + 1) + ".jpg"),
      context: { classLabel, subject, maxMarks, roster },
      expected: { rows },
    },
    pages,
    presentation: {
      title: language >= 2 ? "अंक सूची / Marks list" : "Marks list",
      sub: classLabel + "  ·  " + subject + "  ·  / " + maxMarks,
      fields: language >= 2 ? ["रोल / Roll", "विद्यार्थी / Name", "अंक / Marks"] : ["Roll", "Student", "Marks"],
      x: [83, 255, 805], widths: [140, 530, 130],
      values: (row) => [row.roll, row.name, row.marks],
      kind: "marks", unclearColumn: 2,
    },
  };
}

function coverCase(i) {
  const id = label(i, "cover");
  const date = localDate(i);
  const language = i % 5;
  const count = 5 + i % 6;
  const register = i >= 8;
  const group = i % 2 === 0 ? 4 : 3;
  const romans = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
  const rows = Array.from({ length: count }, (_, j) => {
    const a = (i + (register ? Math.floor(j / group) : j) * 2) % teachers.length;
    const b = (a + 3 + (j % 3)) % teachers.length;
    const period = (i + j) % 8 + 1;
    const hiAbs = language >= 2 && (register ? Math.floor(j / group) : j) % 2 === 0;
    const abs = teachers[a][hiAbs ? 1 : 0] + (register ? (a % 2 === 0 ? " Ma’am" : " Sir") : "");
    const cover = (j === 2 && i % 3 !== 0) || (j === 4 && i % 5 === 1)
      ? "" : teachers[b][language >= 2 && j % 2 === 1 ? 1 : 0];
    return {
      absentTeacher: i === 14 && j < group ? "QZ Ma’am" : abs,
      period: register ? romans[period - 1] : (language >= 2 && j % 3 === 0 ? "पी " + dev(period) : (j % 3 === 1 ? "P" : "") + period),
      classLabel: classes[(i + j) % classes.length],
      substitute: cover,
      unclear: i % 5 === 4 && j === 1,
    };
  });
  if (i === 13) rows[3].substitute = rows[3].absentTeacher;
  if (i === 17) rows[5].period = "P9";
  if (i === 18) rows[4].classLabel = "IX Z";
  if (register && i % 3 === 0) {
    rows[0].classLabel = "3rd EVS";
    rows[1].classLabel = "—";
    rows[1].substitute = "—";
  }
  const asWritten = (iso) => iso.slice(8) + "/" + iso.slice(5, 7) + "/" + iso.slice(2, 4);
  const day = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(new Date(date));
  const datedRows = rows.map((row) => ({ ...row, sourceDate: register ? asWritten(date) : date }));
  const facing = [12, 15, 18].includes(i) ? {
    date: asWritten(new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10)),
  } : undefined;
  return {
    sample: {
      id, action: "substitution-photo", files: ["substitutions/" + id + "-p1.jpg"],
      context: { date, periods: [1, 2, 3, 4, 5, 6, 7, 8], teachers: teachers.map(([initials, hindi], j) => ({ ref: "T" + (j + 1), initials, hindi })) },
      expected: { rows: datedRows },
    },
    pages: [datedRows],
    presentation: register ? {
      title: "Teacher Arrangement",
      sub: "Date: " + asWritten(date) + "      Day: " + day,
      fields: ["S.R. No.", "Absent Teacher", "Class", "Period", "Substitute Teacher", "Activity or Topic", "Sign"],
      x: [76, 188, 471, 650, 759, 1010, 1262], widths: [85, 255, 151, 87, 223, 221, 83],
      values: (row, j) => [
        j % group === 0 ? String(Math.floor(j / group) + 1) : "",
        j % group === 0 ? row.absentTeacher + (j === 0 && i % 2 === 0 ? " (half time)" : "") : "",
        row.classLabel, row.period, row.substitute,
        row.classLabel === "—" ? "—" : ["English", "Revision", "Reading", "Sports"][j % 4],
        j % 3 === 0 ? "✓" : "",
      ],
      kind: "register", unclearColumn: 4, facing, turn: i === 12 ? 270 : i === 15 ? 90 : 0,
    } : {
      title: language >= 2 ? "प्रतिस्थापन / Cover slip" : "Substitution slip",
      sub: date,
      fields: language >= 2 ? ["अनुपस्थित", "पीरियड", "कक्षा", "प्रतिस्थापक"] : ["Absent teacher", "Period", "Class", "Substitute"],
      x: [82, 350, 525, 790], widths: [245, 150, 240, 163],
      values: (row) => [row.absentTeacher, row.period, row.classLabel, row.substitute],
      kind: "cover", unclearColumn: 3,
    },
  };
}

function sheetSvg(rows, presentation, profile, page, pages) {
  const rng = random(profile * 4123 + page * 751 + (presentation.fields.length * 35));
  const register = presentation.kind === "register";
  const paper = register ? 1410 : 1030;
  const facingWidth = presentation.facing ? 244 : 0;
  const width = paper + facingWidth;
  const edge = paper - 56;
  const headerY = 162;
  const short = presentation.kind !== "marks";
  const line = short ? 53 : rows.length > 35 ? 31 : rows.length > 25 ? 35 : 40;
  const height = headerY + rows.length * line + 50;
  const style = profile % 5;
  const useGrid = register || style !== 1;
  const ruled = register || style !== 4;
  const family = ["Segoe Print", "Segoe Script", "Comic Sans MS", "Segoe Print", "Segoe Script"][style];
  const ink = ["#253a70", "#1d3753", "#23242b", "#32254c", "#345766"][style];
  const pageTints = [
    ["#fffdf2", "#f0ebd9"], ["#f6f9fc", "#e3e5e6"], ["#fff8e5", "#e9ddca"],
    ["#fffefd", "#ece7df"], ["#f9f9f4", "#e3e5db"],
  ][style];
  const accent = "#46555f";
  const labelFont = "Nirmala UI, Arial, sans-serif";
  const footer = pages > 1 ? "Page " + (page + 1) + " of " + pages : "";
  const lines = [];
  const finalY = headerY + rows.length * line;
  for (let j = 0; j <= rows.length; j++) {
    const y = headerY + j * line;
    if (ruled) lines.push(`<path d="M62 ${y} H${edge}" stroke="#7394a4" stroke-opacity="${j === 0 ? ".48" : ".24"}" />`);
  }
  if (useGrid) for (const x of [62, ...presentation.x.slice(1).map((v) => v - 18), edge]) {
    lines.push(`<path d="M${x} ${headerY - 41} V${finalY}" stroke="#7394a4" stroke-opacity=".30" />`);
  }
  if (style === 2 || register) lines.push(`<path d="M55 33 V${height - 16}" stroke="#ce7a7c" stroke-opacity=".48" />`);
  const titles = presentation.fields.map((field, j) =>
    `<text x="${presentation.x[j]}" y="${headerY - 12}">${xml(field)}</text>`).join("");
  const writing = rows.map((row, j) => {
    const cells = presentation.values(row, j);
    return cells.map((text, k) => {
      if (!text) return "";
      const x = presentation.x[k] + Math.round(rng() * 10 - 5);
      const y = headerY + j * line + Math.round(line * 0.73 + rng() * 5 - 2);
      const size = Math.min(short ? 31 : line - 6, Math.floor(presentation.widths[k] / Math.max(1, text.length) * 1.33), short ? 34 : 31) - (j % 3 === 0 ? 1 : 0);
      const angle = Math.round((rng() * 8 - 4) * 10) / 10;
      const opacity = (0.77 + rng() * 0.22).toFixed(2);
      const devanagari = /[\u0900-\u097f]/u.test(text);
      const slant = devanagari ? ` transform="translate(${x} ${y}) rotate(${angle}) skewX(${j % 3 === 0 ? -10 : -4})"` : ` transform="translate(${x} ${y}) rotate(${angle})"`;
      const smudge = row.unclear && k === presentation.unclearColumn
        ? `<ellipse cx="${x + 9}" cy="${y - 8}" rx="15" ry="10" fill="${ink}" opacity=".14"/>` : "";
      const redInk = register && k === 4 && j % 3 !== 1 ? ' fill="#8c2e39"' : "";
      return `<text${slant} font-size="${size}" font-family="${devanagari ? labelFont : family + ", Comic Sans MS, sans-serif"}" opacity="${opacity}"${redInk}${j % 13 === 0 ? ' font-weight="600"' : ""}>${xml(text)}</text>` + smudge;
    }).join("");
  }).join("");
  const specks = Array.from({length: 135}, () => `<circle cx="${Math.floor(rng() * width)}" cy="${Math.floor(rng() * height)}" r="${(rng() * 1.6).toFixed(1)}" fill="#57472d" opacity=".05"/>`).join("");
  const facingPage = presentation.facing ? `<rect width="${facingWidth}" height="${height}" fill="#e9e3d4"/>
<path d="M${facingWidth - 2} 0 V${height}" stroke="#ad9f89" stroke-width="4"/>
<g fill="#4c5562" font-family="${labelFont}" font-size="19"><text x="13" y="81">Teacher Arrangement</text>
<text x="13" y="111">Date: ${xml(presentation.facing.date)}</text><text x="13" y="150">Class · Period · Cover</text>
<text x="13" y="200">XI Arts   IV   ZX</text><text x="13" y="253">9C   V   YZ</text></g>
<path d="M0 162 H${facingWidth} M0 215 H${facingWidth} M0 268 H${facingWidth}" stroke="#8da2ab" opacity=".45"/>` : "";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><linearGradient id="paper" x2="1" y2="1"><stop stop-color="${pageTints[0]}"/><stop offset="1" stop-color="${pageTints[1]}"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#paper)"/>${specks}${facingPage}
<g transform="translate(${facingWidth} 0)">
<g font-family="${labelFont}" fill="${accent}"><text x="65" y="41" font-size="15" letter-spacing="1.3">SYNTHETIC TEST · TEST-2026-27</text>
<text x="65" y="81" font-size="31" font-weight="600">${xml(presentation.title)}</text>
<text x="65" y="111" font-size="22">${xml(presentation.sub)}</text><text x="865" y="105" font-size="15">${xml(footer)}</text>
<g font-size="21" font-weight="600">${titles}</g></g>
${lines.join("")}<g fill="${ink}">${writing}</g></g></svg>`, "utf8");
}

async function render({ sample, pages, presentation }, root, profile) {
  const desks = ["#bdb5a2", "#9ea4a3", "#c6b39b", "#91959c", "#c6c1b4"];
  for (const [page, rows] of pages.entries()) {
    const style = profile % desks.length;
    const desk = desks[style];
    const angle = [0.8, -2.4, 3.5, -4.7, 1.5][style] + page * 0.5 + (presentation.turn ?? 0);
    const padded = await sharp(sheetSvg(rows, presentation, profile, page, pages.length))
      .extend({ top: 18 + style * 3, bottom: 23, left: 22, right: 27, background: desk }).png().toBuffer();
    let photo = sharp(padded).rotate(angle, { background: desk }).resize(1600, 1600, { fit: "inside", withoutEnlargement: true });
    if (style === 2 || style === 3) photo = photo.blur(style === 2 ? 0.35 : 0.55);
    await photo.jpeg({ quality: [87, 82, 77, 71, 84][style], mozjpeg: true }).toFile(path.join(root, sample.files[page]));
  }
}

async function makePreview(root, cases) {
  const selected = [cases[1], cases[16], cases[29], cases[38]];
  const tiles = await Promise.all(selected.map(({ sample }) =>
    sharp(path.join(root, sample.files[0])).resize(540, 505, {
      fit: "contain", background: "#e9edf1", withoutEnlargement: false,
    }).jpeg().toBuffer()));
  await sharp({ create: { width: 1130, height: 1055, channels: 3, background: "#d9e1e9" } })
    .composite(tiles.map((input, i) => ({ input, left: 15 + (i % 2) * 560, top: 15 + Math.floor(i / 2) * 520 })))
    .jpeg({ quality: 85 }).toFile(path.join(root, "preview.jpg"));
}

async function main() {
  const [destination, ...rest] = process.argv.slice(2);
  if (!destination || rest.length) throw new Error("Usage: npm run ai:fixtures -- <new fixture folder outside the checkout>");
  const parent = await realpath(path.dirname(path.resolve(destination)));
  const root = path.join(parent, path.basename(path.resolve(destination)));
  const checkout = await realpath(process.cwd());
  const rel = path.relative(checkout, root);
  if (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep)) {
    throw new Error("Choose a new fixture folder outside the checkout.");
  }
  await mkdir(root);
  await mkdir(path.join(root, "marks"));
  await mkdir(path.join(root, "substitutions"));
  const cases = [...sizes.map((_, i) => marksCase(i)), ...sizes.map((_, i) => coverCase(i))];
  for (const [i, entry] of cases.entries()) await render(entry, root, i);
  await makePreview(root, cases);
  const manifest = { provenance: "synthetic", cases: cases.map(({ sample }) => sample) };
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(path.join(root, "README.md"), [
    "# VPPS One built-in AI photo fixtures",
    "",
    "20 marks lists and 20 substitution slips (44 JPEG pages), with exact written values, prompts' context, and answer keys in manifest.json. All names, rolls, marks and assignments were generated offline. The JPEGs simulate photographed pages; the Hindi lettering is rendered from a font, and none of the writing came from teachers. No One record or staff document is included.",
    "",
    "The pack covers single and multiple pages, 40-row papers, Hindi and mixed language, half marks, zero, absences, blanks, missing and repeated students, roll/name mismatches, teacher initials, empty substitutes, and deliberately bad periods or classes. Some images have tilt, sideways rotation, blur and lower contrast. Register cases use grouped absent teachers, Roman numerals, extra activity/signature columns and, in some photos, a partial facing page for a different date.",
    "",
    "From the pilot checkout, run npm run ai:eval -- --validate-only with this folder to check it offline. Use --run-synthetic for an expressly approved paid model comparison. Synthetic scores cannot clear the real handwriting acceptance gate.",
    "",
    "To collect real handwriting without using any student data: ask staff to hand-copy the fictional rows onto their usual paper, then photograph the pages on their normal phones. Keep the answer key in the same row order, correct it for anything actually written differently, and keep that separately reviewed pack private.",
    "",
  ].join("\n"));
  console.log("Created 20 marks lists and 20 substitution slips (44 JPEG pages).");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
