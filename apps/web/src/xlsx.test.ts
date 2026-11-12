import { expect, test } from "vitest";
import {
  parseSharedStrings,
  parseWorksheet,
  tableFromRows,
  xlsxToRows,
  zipEntries,
} from "./xlsx.js";

/* The XLSX reader (WS3.6, issue #294): an .xlsx is a ZIP of XML. This builds a
 * real ZIP (deflate-raw, the browser's own CompressionStream) so the reader is
 * exercised against the actual container layout, not a mock. */

function crc32(): number {
  return 0; // the reader does not verify CRC; Excel's own writer does not need it here
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zip(files: { name: string; content: string }[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = encoder.encode(file.content);
    const compressed = await deflateRaw(raw);
    const local = new Uint8Array(30 + name.length + compressed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 8, true); // deflate
    lv.setUint32(14, crc32(), true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(compressed, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(), true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const total = new Uint8Array(offset + centralSize + eocd.length);
  let cursor = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    total.set(part, cursor);
    cursor += part.length;
  }
  return total;
}

const sharedStrings = `<?xml version="1.0"?><sst xmlns="x"><si><t>Datum</t></si><si><t>Tegenpartij</t></si><si><t>Bedrag</t></si><si><t>Albert Heijn</t></si><si><t>Werkgever</t></si></sst>`;

const sheet = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
  <row r="2"><c r="A2"><v>46204</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>-25.5</v></c></row>
  <row r="3"><c r="A3"><v>46205</v></c><c r="C3"><v>2000</v></c></row>
</sheetData></worksheet>`;

test("the reader walks a real ZIP and returns the worksheet rows", async () => {
  const bytes = await zip([
    { name: "xl/sharedStrings.xml", content: sharedStrings },
    { name: "xl/worksheets/sheet1.xml", content: sheet },
  ]);
  const entries = zipEntries(bytes).map((entry) => entry.name);
  expect(entries).toContain("xl/worksheets/sheet1.xml");
  const rows = await xlsxToRows(bytes);
  // Cells are placed by their A1 reference: row 3 has a hole in B and it stays
  // a hole, so the amount lands in column C.
  expect(rows).toEqual([
    ["Datum", "Tegenpartij", "Bedrag"],
    ["46204", "Albert Heijn", "-25.5"],
    ["46205", "", "2000"],
  ]);
  const table = tableFromRows(rows);
  expect(table.headers).toEqual(["Datum", "Tegenpartij", "Bedrag"]);
  expect(table.rows).toHaveLength(2);
});

test("shared strings are read in order, including multi-run cells", () => {
  const xml = "<sst><si><t>A</t></si><si><r><t>B</t></r><r><t>C</t></r></si></sst>";
  expect(parseSharedStrings(xml)).toEqual(["A", "BC"]);
});

test("a worksheet with inline strings and a missing reference parses", () => {
  const rows = parseWorksheet(
    '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Datum</t></is></c></row></sheetData></worksheet>',
    [],
  );
  expect(rows).toEqual([["Datum"]]);
  // A file that is not a ZIP fails loudly instead of returning an empty table.
  expect(() => zipEntries(new Uint8Array([1, 2, 3]))).toThrow();
});
