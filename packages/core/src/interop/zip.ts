/**
 * Minimal, dependency-free ZIP writer/reader for the LaVega export (WS6.1).
 *
 * STORE only (no compression): the export is a portability artifact, not a
 * download-size optimisation, and a stored archive can be produced and read by
 * the same audited code without a third-party dependency. Determinism matters:
 * the same records must produce byte-identical archives, so every entry gets a
 * fixed DOS timestamp (1980-01-01) rather than a clock read (core is clock-free).
 *
 * The reader validates the CRC of every entry, so "the file downloaded" is not
 * accepted as proof: the bytes must round-trip the checksum this writer wrote.
 * Unsupported shapes (compression, ZIP64, encryption) are refused loudly.
 */

export type ZipEntry = {
  /** Forward-slash path inside the archive. */
  path: string;
  bytes: Uint8Array;
};

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

/** DOS date for 1980-01-01: the earliest representable timestamp. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const utf8 = new TextEncoder();

type Prepared = {
  pathBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
};

/** Build a stored (uncompressed) ZIP from entries, in the order given. */
export function buildStoreZip(entries: readonly ZipEntry[], comment = "lavega-export"): Uint8Array {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.path === "" || entry.path.startsWith("/") || entry.path.includes("..")) {
      throw new Error(`ongeldig zip-pad: ${entry.path}`);
    }
    if (seen.has(entry.path)) throw new Error(`dubbel zip-pad: ${entry.path}`);
    seen.add(entry.path);
  }

  const prepared: Prepared[] = [];
  let size = 0;
  for (const entry of entries) {
    const pathBytes = utf8.encode(entry.path);
    // Local header (30) + name + data.
    prepared.push({ pathBytes, data: entry.bytes, crc: crc32(entry.bytes), offset: size });
    size += 30 + pathBytes.length + entry.bytes.length;
  }
  const centralStart = size;
  for (const entry of prepared) size += 46 + entry.pathBytes.length;
  const commentBytes = utf8.encode(comment);
  const out = new Uint8Array(size + 22 + commentBytes.length);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (value: number) => {
    view.setUint16(at, value, true);
    at += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(at, value >>> 0, true);
    at += 4;
  };
  const bytes = (data: Uint8Array) => {
    out.set(data, at);
    at += data.length;
  };

  for (const entry of prepared) {
    u32(LOCAL_HEADER);
    u16(20); // version needed
    u16(0); // flags
    u16(0); // method: store
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.pathBytes.length);
    u16(0); // extra length
    bytes(entry.pathBytes);
    bytes(entry.data);
  }

  for (const entry of prepared) {
    u32(CENTRAL_HEADER);
    u16(20); // version made by
    u16(20); // version needed
    u16(0); // flags
    u16(0); // method
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.pathBytes.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attrs
    u32(0); // external attrs
    u32(entry.offset);
    bytes(entry.pathBytes);
  }

  u32(END_OF_CENTRAL);
  u16(0); // disk
  u16(0); // disk with central dir
  u16(prepared.length);
  u16(prepared.length);
  u32(size - centralStart);
  u32(centralStart);
  u16(commentBytes.length);
  bytes(commentBytes);
  return out;
}

/** Read a stored ZIP. Throws on a malformed archive, a compressed entry, a
 *  duplicate path or a CRC mismatch: a corrupt export is not "empty data". */
export function readStoreZip(input: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let at = 0;
  const need = (count: number) => {
    if (at + count > input.length) throw new Error("zip onvolledig");
  };
  const u16 = () => {
    need(2);
    const value = view.getUint16(at, true);
    at += 2;
    return value;
  };
  const u32 = () => {
    need(4);
    const value = view.getUint32(at, true);
    at += 4;
    return value;
  };
  const skip = (count: number) => {
    need(count);
    at += count;
  };

  const entries = new Map<string, Uint8Array>();
  while (at + 4 <= input.length) {
    const signature = view.getUint32(at, true);
    if (signature === CENTRAL_HEADER || signature === END_OF_CENTRAL) break;
    if (signature !== LOCAL_HEADER) throw new Error("zip-handtekening onbekend");
    at += 4;
    skip(2); // version needed
    const flags = u16();
    if ((flags & 0x1) !== 0) throw new Error("versleutelde zip wordt niet ondersteund");
    const method = u16();
    if (method !== 0) throw new Error("gecomprimeerde zip wordt niet ondersteund");
    skip(4); // dos time/date
    const crc = u32();
    const compressedSize = u32();
    const uncompressedSize = u32();
    if (compressedSize !== uncompressedSize) throw new Error("zip-grootte klopt niet");
    const nameLength = u16();
    const extraLength = u16();
    need(nameLength);
    const path = new TextDecoder().decode(input.subarray(at, at + nameLength));
    at += nameLength;
    skip(extraLength);
    need(uncompressedSize);
    const data = input.slice(at, at + uncompressedSize);
    at += uncompressedSize;
    if (entries.has(path)) throw new Error(`dubbel zip-pad: ${path}`);
    if (crc32(data) !== crc) throw new Error(`zip-CRC klopt niet: ${path}`);
    entries.set(path, data);
  }
  if (entries.size === 0) throw new Error("zip bevat geen bestanden");
  return entries;
}

export const utf8Bytes = (text: string): Uint8Array => utf8.encode(text);
export const utf8Text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
