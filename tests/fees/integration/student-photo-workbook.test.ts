import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import * as XLSX from "xlsx";

vi.mock("server-only", () => ({}));
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/modules/fees/platform/supabase/server", () => ({
  createClient: async () => ({ storage: { from: (bucket: string) => {
    expect(bucket).toBe("student-photos");
    return { download };
  } } }),
}));
import { studentPhotoWorkbookResponse } from "@/modules/exports/data/student-photo-workbook";

beforeEach(() => download.mockReset());

describe("student photo Excel file", () => {
  it("embeds images on their student rows and retains missing and damaged photo records", async () => {
    const png = await sharp({ create: { width: 160, height: 120, channels: 3, background: "red" } }).png().toBuffer();
    download.mockImplementation(async (path: string) => {
      if (path === "missing.jpg") return { data: null, error: new Error("Missing") };
      if (path === "broken.jpg") return { data: new Blob(["broken"]), error: null };
      // Finish row 5 before row 1 to prove asynchronous downloads don't reorder photos.
      if (path === "first.png") await new Promise((resolve) => setTimeout(resolve, 20));
      return { data: new Blob([new Uint8Array(png)]), error: null };
    });
    const rows = ["TEST-001", "TEST-002", "TEST-003", "TEST-004", "TEST-005"].map((sr, i) => ({
      "SR no": sr, Student: `Test student ${i}`, "Aadhaar no": "000000000001",
    }));
    const response = await studentPhotoWorkbookResponse("TEST-2026-27.xlsx", rows,
      [{ photoPath: "first.png" }, {}, { photoPath: "missing.jpg" }, { photoPath: "broken.jpg" }, { photoPath: "last.png" }],
      ["SR no", "Student", "Aadhaar no"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = new Uint8Array(await response.arrayBuffer());
    const workbook = XLSX.read(data);
    const records = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]]);
    expect(records.map((row) => row["SR no"])).toEqual(rows.map((row) => row["SR no"]));
    expect(records.map((row) => row["Photo status"])).toEqual([
      "Included", "Not uploaded", "Unavailable - upload again", "Unavailable - upload again", "Included",
    ]);
    expect(records[0]["Aadhaar no"]).toBe("000000000001");
    const files = unzipSync(data);
    const drawing = strFromU8(files["xl/drawings/drawing1.xml"]);
    expect(drawing.match(/<xdr:row>\d+<\/xdr:row>/g)).toEqual(["<xdr:row>1</xdr:row>", "<xdr:row>5</xdr:row>"]);
    expect(strFromU8(files["xl/worksheets/sheet1.xml"])).toContain('<drawing r:id="rIdPhotos"/>');
    expect(strFromU8(files["xl/worksheets/sheet1.xml"])).toContain('state="frozen"');
    expect(strFromU8(files["xl/drawings/_rels/drawing1.xml.rels"])).toContain('Target="../media/student-photo-2.jpeg"');
    expect(strFromU8(files["[Content_Types].xml"])).toContain('ContentType="image/jpeg"');
    const image = await sharp(files["xl/media/student-photo-1.jpeg"]).metadata();
    expect([image.format, image.width, image.height]).toEqual(["jpeg", 80, 100]);
    expect(drawing).not.toContain("https://");
  });

  it("keeps headers for an empty session without fetching photos or adding dangling relationships", async () => {
    const response = await studentPhotoWorkbookResponse("TEST-2026-27.xlsx", [], [], ["SR no", "Student"]);
    const data = new Uint8Array(await response.arrayBuffer());
    const workbook = XLSX.read(data);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })).toEqual([
      ["Photo", "Photo status", "SR no", "Student"],
    ]);
    expect(download).not.toHaveBeenCalled();
    expect(unzipSync(data)["xl/drawings/drawing1.xml"]).toBeUndefined();
  });
});
