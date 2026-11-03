// Reads the cells of an .xlsx workbook, with no dependencies: a .xlsx is a zip of XML files.
// Enough for the hand-kept sheets the builders read (text and numbers; no formulas evaluated).

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/**
 * The files in a zip archive, by name.
 * @param {Buffer} buf @returns {Map<string, Buffer>}
 */
function unzip(buf) {
  // The end of central directory record: the last "PK\5\6".
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    // The data follows the local header, whose name and extra field lengths can differ.
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unxml = (/** @type {string} */ s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** A column's letters as a 0-based index: A = 0, AA = 26. @param {string} col */
export const columnIndex = col => [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/**
 * Each sheet's cells as rows of strings (empty where there's nothing), by sheet name.
 * @param {string | URL} file @returns {Map<string, string[][]>}
 */
export function readXlsx(file) {
  const files = unzip(readFileSync(file));
  const text = (/** @type {string} */ name) => files.get(name)?.toString('utf8') ?? '';
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  // Sheet names to their files, through the workbook's relationships.
  const rels = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)]
    .map(m => [m[1], m[2].replace(/^\/?(xl\/)?/, 'xl/')]));
  /** @type {Map<string, string[][]>} */
  const sheets = new Map();
  for (const m of text('xl/workbook.xml').matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)) {
    /** @type {string[][]} */
    const rows = [];
    for (const row of text(rels.get(m[2]) ?? '').matchAll(/<row [^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      /** @type {string[]} */
      const cells = [];
      for (const c of row[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = c[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[3]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
        const value = /t="s"/.test(c[2]) ? shared[Number(v)] ?? '' : unxml(v);
        if (value) cells[columnIndex(c[1])] = value;
      }
      rows[Number(row[1]) - 1] = Array.from(cells, x => x ?? '');
    }
    sheets.set(unxml(m[1]), Array.from(rows, r => r ?? []));
  }
  return sheets;
}
