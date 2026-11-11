/* A minimal XLSX reader (WS3.6, issue #294). An .xlsx file is a ZIP of XML
 * parts; the browser already has the inflater (DecompressionStream), so this
 * module walks the ZIP's central directory and returns the first worksheet as
 * plain rows — exactly the shape the generic CSV session already imports. No
 * dependency, no macro, no formula evaluation: values as Excel wrote them.
 *
 * Kept out of core on purpose: `DecompressionStream` is a platform API, and
 * core must stay a pure library over arrays. The mapping/dedupe logic that
 * follows lives in `@lavega/core`'s csvImport. */

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

/** The ZIP's central directory: name, compression method, sizes and where the
 *  local header starts. Handles ZIP64 only by failing loudly (an .xlsx from
 *  Excel is far below the 4 GB boundary). */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: signature 0x06054b50, scanned from the tail
  // because a ZIP comment may follow it.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65_557; i -= 1) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx: geen ZIP-einde gevonden");
  const count = u16(view, eocd + 10);
  let cursor = u32(view, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (u32(view, cursor) !== 0x02014b50) throw new Error("xlsx: central directory beschadigd");
    const method = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const offset = u32(view, cursor + 42);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.push({ name, method, compressedSize, offset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(
  bytes: Uint8Array,
  entries: ZipEntry[],
  name: string,
): Promise<string | null> {
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry == null) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (u32(view, entry.offset) !== 0x04034b50) throw new Error("xlsx: lokaal ZIP-header beschadigd");
  const nameLength = u16(view, entry.offset + 26);
  const extraLength = u16(view, entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const payload = bytes.subarray(start, start + entry.compressedSize);
  const raw = entry.method === 0 ? payload : await inflateRaw(payload);
  return new TextDecoder().decode(raw);
}

function xmlText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Shared-string table (`xl/sharedStrings.xml`), in order. */
export function parseSharedStrings(xml: string | null): string[] {
  if (xml == null) return [];
  const out: string[] = [];
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // A shared string may be split over several <r><t> runs.
    const runs = [...(si[1] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? "");
    out.push(xmlText(runs.join("")));
  }
  return out;
}

function columnIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/i)?.[0] ?? "A").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** The rows of a worksheet, cells placed by their A1 reference so a skipped
 *  cell does not shift a column. */
export function parseWorksheet(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1] ?? "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "n";
      const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? null;
      const inline = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1];
      const value =
        inline != null
          ? xmlText(inline)
          : raw == null
            ? ""
            : type === "s"
              ? (shared[Number(raw)] ?? "")
              : xmlText(raw);
      const index = columnIndex(ref);
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    // A row with fewer cells than the widest row is padded later by the caller.
    rows.push(cells);
  }
  return rows;
}

/** First worksheet of the workbook (the only one this session imports). */
function firstWorksheetPath(entries: readonly ZipEntry[]): string {
  const sheets = entries
    .map((entry) => entry.name)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/sheet(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.match(/sheet(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    });
  const first = sheets[0];
  if (first == null) throw new Error("xlsx: geen werkblad gevonden");
  return first;
}

/**
 * An .xlsx file's first worksheet as rows. Empty trailing cells are padded so
 * every row has the header's width, and wholly empty rows are dropped — the
 * generic session only ever sees data rows.
 */
export async function xlsxToRows(bytes: Uint8Array): Promise<string[][]> {
  const entries = zipEntries(bytes);
  const sharedXml = await readEntry(bytes, entries, "xl/sharedStrings.xml");
  const sheetXml = await readEntry(bytes, entries, firstWorksheetPath(entries));
  if (sheetXml == null) throw new Error("xlsx: werkblad onleesbaar");
  const shared = parseSharedStrings(sharedXml);
  const rows = parseWorksheet(sheetXml, shared).filter((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")]);
}

/** The first row becomes headers when a caller wants the CSV session's shape. */
export function tableFromRows(rows: string[][]): { headers: string[]; rows: string[][] } {
  return { headers: rows[0] ?? [], rows: rows.slice(1) };
}
