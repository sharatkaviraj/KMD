import "server-only";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import sharp from "sharp";

import { createClient } from "@/modules/fees/platform/supabase/server";

type PhotoStudent = { photoPath?: string | null };
type ExportRow = Record<string, string | number>;
const RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Embed small copies, never signed URLs: the workbook still works offline. */
export async function studentPhotoWorkbookResponse(
  filename: string,
  rows: ExportRow[],
  students: PhotoStudent[],
  headers: string[],
): Promise<Response> {
  const supabase = await createClient();
  const images: Array<{ row: number; data: Uint8Array }> = [];
  const statuses = students.map(() => "Not uploaded");

  // Bound simultaneous storage reads and image decodes for a whole-school file.
  for (let start = 0; start < students.length; start += 8) {
    await Promise.all(students.slice(start, start + 8).map(async (student, offset) => {
      const index = start + offset;
      if (!student.photoPath) return;
      statuses[index] = "Unavailable - upload again";
      try {
        const { data, error } = await supabase.storage.from("student-photos").download(student.photoPath);
        if (error || !data || data.size > 10 * 1024 * 1024) return;
        const thumbnail = await sharp(Buffer.from(await data.arrayBuffer()), { limitInputPixels: 25_000_000 })
          .rotate()
          .resize(80, 100, { fit: "contain", background: "#ffffff" })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 65 })
          .toBuffer();
        images.push({ row: index + 1, data: new Uint8Array(thumbnail) });
        statuses[index] = "Included";
      } catch {
        // A damaged/missing object must not drop the student's record.
      }
    }));
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows.map((row, index) => ({
    Photo: "", "Photo status": statuses[index], ...row,
  })), { header: ["Photo", "Photo status", ...headers] });
  sheet["!cols"] = [
    { wch: 14 }, { wch: 28 },
    ...headers.map((header) => ({ wch: Math.min(36, Math.max(14, header.length + 2)) })),
  ];
  sheet["!rows"] = [{ hpt: 24 }, ...rows.map(() => ({ hpt: 84 }))];
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  XLSX.utils.book_append_sheet(workbook, sheet, "Students with photos");
  const files = unzipSync(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  let sheetXml = strFromU8(files["xl/worksheets/sheet1.xml"]);
  sheetXml = sheetXml.replace(/<sheetView([^>]*)\/>/, '<sheetView$1><pane xSplit="4" ySplit="1" topLeftCell="E2" activePane="bottomRight" state="frozen"/></sheetView>');

  if (images.length) {
    sheetXml = sheetXml.replace("</worksheet>", '<drawing r:id="rIdPhotos"/></worksheet>');
    files["xl/worksheets/_rels/sheet1.xml.rels"] = strToU8(
      `<Relationships xmlns="${RELS}"><Relationship Id="rIdPhotos" Type="${OFFICE_RELS}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    );
    // Row numbers, rather than download completion order, keep each photo on its student.
    images.sort((a, b) => a.row - b.row);
    const anchors = images.map((image, index) => {
      const id = index + 1;
      files[`xl/media/student-photo-${id}.jpeg`] = new Uint8Array(image.data);
      return `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>${image.row}</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:from><xdr:ext cx="762000" cy="952500"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Student photo ${id}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="762000" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
    }).join("");
    files["xl/drawings/drawing1.xml"] = strToU8(
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_RELS}">${anchors}</xdr:wsDr>`,
    );
    files["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(
      `<Relationships xmlns="${RELS}">${images.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${OFFICE_RELS}/image" Target="../media/student-photo-${index + 1}.jpeg"/>`).join("")}</Relationships>`,
    );
    const types = strFromU8(files["[Content_Types].xml"]);
    files["[Content_Types].xml"] = strToU8(types.replace("</Types>",
      '<Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'));
  }
  files["xl/worksheets/sheet1.xml"] = strToU8(sheetXml);
  const data = zipSync(files, { level: 6 });
  // Leave room below Vercel's 4.5 MB response ceiling; never silently truncate.
  if (data.byteLength > 4 * 1024 * 1024) {
    return new Response("This photo export is too large. Choose one class at a time in Exports.", { status: 413 });
  }
  return new Response(data, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
