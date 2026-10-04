// Reading ONLY the note chart out of a Clone Hero .sng package — never its audio, video or images.
// Shared by the bridge (bridge/lib/charts.js, Node) and the browser (rhythm/charts.js); no DOM, no Node APIs.
//
// .sng layout (github.com/mdsitton/SngFileFormat, little endian):
//   header    "SNGPKG" (6) · version uint32 · xorMask byte[16]                                   = 26 bytes
//   metadata  metadataLen uint64 (bytes after this field) · metadataCount uint64 ·
//             pairs: keyLen int32 · key · valueLen int32 · value          (= the song.ini values)
//   fileIndex fileMetaLen uint64 (bytes after this field) · fileCount uint64 ·
//             entries: nameLen byte · name · contentsLen uint64 · contentsIndex uint64 (absolute offset in the .sng)
//   fileData  fileDataLen uint64 · the files' bytes, each masked: b ^ (xorMask[i % 16] ^ (i & 0xff)), i = index in the file
//
// With HTTP Range requests the header + metadata + file index (a few KB) and then the notes file's own byte range
// are all that is read: the audio stems (song.opus, guitar.ogg …), video and album art are skipped entirely.
//
//   const r = await extractSngNotes((start, end) => fetchRange(url, start, end));   // end exclusive
//   → { format: 'mid' | 'chart', bytes: Uint8Array, file, ini: { name, artist, delay, … }, files: [{ name, size }], version, reads }

export const SNG_MAGIC = 'SNGPKG';
const dec = new TextDecoder();
const u64 = (dv, o) => { const lo = dv.getUint32(o, true), hi = dv.getUint32(o + 4, true); return hi * 4294967296 + lo; };

/** Remove the .sng mask from a file's bytes (`from` = index of bytes[0] within that file). */
export function unmask(bytes, xorMask, from = 0) {
  const out = new Uint8Array(bytes.length);
  for (let k = 0; k < bytes.length; k++) { const i = from + k; out[k] = bytes[k] ^ xorMask[i & 15] ^ (i & 0xff); }
  return out;
}

/**
 * Read the header, metadata (song.ini values) and the file index.
 * @param {(start: number, end: number) => Promise<Uint8Array>} readRange  bytes [start, end) — may return fewer at EOF
 * @param {{ first?: number }} [opts]  bytes in the first request (34 = header + the metadata length; every later
 *   request asks for exactly the next section, so not a byte of the packaged files is read here)
 */
export async function readSngIndex(readRange, { first = 34 } = {}) {
  let buf = await readRange(0, first);
  const reads = [[0, buf.length]];
  const need = async (end) => {         // make sure buf covers [0, end)
    if (end <= buf.length) return;
    if (end > 64 * 1024 * 1024) throw new Error('This .sng has an unreasonably large index');
    const more = await readRange(buf.length, end);
    reads.push([buf.length, buf.length + more.length]);
    const b = new Uint8Array(buf.length + more.length); b.set(buf); b.set(more, buf.length); buf = b;
    if (buf.length < end) throw new Error('The .sng file is truncated');
  };
  await need(34);
  if (dec.decode(buf.subarray(0, 6)) !== SNG_MAGIC) throw new Error('Not a .sng chart package');
  let dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = dv.getUint32(6, true);
  const xorMask = buf.slice(10, 26);
  // metadata
  const metaLen = u64(dv, 26);
  const metaEnd = 34 + metaLen;
  await need(metaEnd + 16);
  dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const metaCount = u64(dv, 34);
  const ini = {};
  let o = 42;
  for (let i = 0; i < metaCount && o < metaEnd; i++) {
    const kl = dv.getInt32(o, true); o += 4;
    const k = dec.decode(buf.subarray(o, o + kl)); o += kl;
    const vl = dv.getInt32(o, true); o += 4;
    const v = dec.decode(buf.subarray(o, o + vl)); o += vl;
    ini[k.trim().toLowerCase()] = v;
  }
  // file index
  const idxLen = u64(dv, metaEnd);
  const idxEnd = metaEnd + 8 + idxLen;
  await need(idxEnd);
  dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = u64(dv, metaEnd + 8);
  const files = [];
  o = metaEnd + 16;
  for (let i = 0; i < count && o < idxEnd; i++) {
    const nl = buf[o]; o += 1;
    const name = dec.decode(buf.subarray(o, o + nl)); o += nl;
    const size = u64(dv, o); o += 8;
    const offset = u64(dv, o); o += 8;
    files.push({ name, size, offset });
  }
  return { version, xorMask, ini, files, indexEnd: idxEnd, reads };
}

const base = (name) => String(name).split('/').pop().toLowerCase();
/** The note chart in a file list: notes.mid (what Clone Hero / YARG prefer) or notes.chart. */
export function pickNotesFile(files) {
  return files.find((f) => base(f.name) === 'notes.mid') || files.find((f) => base(f.name) === 'notes.chart')
    || files.find((f) => /\.mid$/i.test(f.name)) || files.find((f) => /\.chart$/i.test(f.name)) || null;
}

/** Read one file out of the package (just its byte range) and unmask it. */
export async function readSngFile(readRange, idx, file) {
  if (!file.size) return new Uint8Array(0);
  const raw = await readRange(file.offset, file.offset + file.size);
  idx.reads?.push([file.offset, file.offset + raw.length]);
  if (raw.length < file.size) throw new Error(`${file.name} is truncated`);
  return unmask(raw, idx.xorMask, 0);
}

/** Header + index, then only the notes file (and a song.ini if the package carries one). */
export async function extractSngNotes(readRange, { maxNotesBytes = 8 * 1024 * 1024 } = {}) {
  const idx = await readSngIndex(readRange);
  const notes = pickNotesFile(idx.files);
  if (!notes) throw new Error('This chart package has no notes.chart or notes.mid');
  if (notes.size > maxNotesBytes) throw new Error(`${notes.name} is too large (${notes.size} bytes)`);
  const bytes = await readSngFile(readRange, idx, notes);
  let ini = { ...idx.ini };
  const iniFile = idx.files.find((f) => base(f.name) === 'song.ini');
  if (iniFile && iniFile.size < 256 * 1024) {
    try { ini = { ...parseIni(dec.decode(await readSngFile(readRange, idx, iniFile))), ...ini }; } catch {}
  }
  return {
    format: /\.mid$/i.test(notes.name) ? 'mid' : 'chart', bytes, file: notes.name, ini,
    files: idx.files.map((f) => ({ name: f.name, size: f.size })), version: idx.version, reads: idx.reads,
  };
}

/** song.ini text → { key: value } (keys lower-case; the [song] section, or everything when there are no sections). */
export function parseIni(text) {
  const out = {};
  let sec = '';
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s[0] === ';' || s[0] === '#') continue;
    const m = /^\[(.+)\]$/.exec(s);
    if (m) { sec = m[1].trim().toLowerCase(); continue; }
    const eq = s.indexOf('=');
    if (eq < 0 || (sec && sec !== 'song')) continue;
    out[s.slice(0, eq).trim().toLowerCase()] = s.slice(eq + 1).trim();
  }
  return out;
}
