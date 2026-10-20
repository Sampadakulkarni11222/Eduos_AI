/**
 * A small QR Code encoder (ISO/IEC 18004): byte mode, error correction level
 * M, versions 1–10 (up to 213 bytes, plenty for a short link). Follows the
 * standard construction: data bits, Reed–Solomon error correction over
 * GF(256) with the 0x11D polynomial, block interleaving, function patterns,
 * the zig-zag data placement, mask choice by penalty score, format and
 * version information. Returns the module matrix (true = dark); toSvgPath()
 * turns it into one SVG path.
 */

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const MAX_VERSION = 10;

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

export function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
export const dataCodewords = (ver: number) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver];

export function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

export function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (r.shift() as number);
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); });
  }
  return r;
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** Data codewords for byte mode at a version (terminator and pad bytes included). */
function dataFor(bytes: number[], ver: number): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

/** Splits into blocks, adds error correction and interleaves, as the standard lays out. */
export function withEcc(data: number[], ver: number): number[] {
  const numBlocks = BLOCKS_M[ver];
  const eccLen = ECC_PER_BLOCK_M[ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => { if (i !== shortLen - eccLen || j >= numShort) out.push(blk[i]); });
  }
  return out;
}

export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

export function formatBits(mask: number): number {
  const data = (0 << 3) | mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

type Grid = { size: number; dark: boolean[][]; fn: boolean[][] };

function setFn(g: Grid, x: number, y: number, dark: boolean) { g.dark[y][x] = dark; g.fn[y][x] = true; }

function drawFormat(g: Grid, mask: number) {
  const bits = formatBits(mask);
  const s = g.size;
  for (let i = 0; i <= 5; i++) setFn(g, 8, i, bit(bits, i));
  setFn(g, 8, 7, bit(bits, 6));
  setFn(g, 8, 8, bit(bits, 7));
  setFn(g, 7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) setFn(g, 14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) setFn(g, s - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) setFn(g, 8, s - 15 + i, bit(bits, i));
  setFn(g, 8, s - 8, true);
}

function drawFunctionPatterns(g: Grid, ver: number) {
  const s = g.size;
  for (let i = 0; i < s; i++) { setFn(g, 6, i, i % 2 === 0); setFn(g, i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [s - 4, 3], [3, s - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx; const y = cy + dy;
      if (x >= 0 && x < s && y >= 0 && y < s) setFn(g, x, y, d !== 2 && d !== 4);
    }
  }
  const pos = alignmentPositions(ver);
  const n = pos.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(g, pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  drawFormat(g, 0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = s - 11 + (i % 3); const b = Math.floor(i / 3);
      setFn(g, a, b, bit(bits, i)); setFn(g, b, a, bit(bits, i));
    }
  }
}

/** The data-module positions in placement order (the standard's two-column zig-zag). */
export function placementOrder(g: { size: number; fn: boolean[][] }): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let right = g.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < g.size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const up = ((right + 1) & 2) === 0;
      const y = up ? g.size - 1 - v : v;
      if (!g.fn[y][x]) out.push([x, y]);
    }
  }
  return out;
}

export function maskHit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(g: Grid, mask: number) {
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fn[y][x] && maskHit(mask, x, y)) g.dark[y][x] = !g.dark[y][x];
}

/** Penalty rules 1 (runs), 2 (2×2 blocks), 3 (finder-like runs) and 4 (balance). */
function penalty(g: Grid): number {
  const s = g.size;
  let p = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= s; i++) {
      if (i < s && get(i) === get(i - 1)) run++;
      else { if (run >= 5) p += 3 + (run - 5); run = 1; }
    }
    const pattern = [true, false, true, true, true, false, true];
    for (let i = 0; i + 7 <= s; i++) {
      if (pattern.every((v, k) => get(i + k) === v)) {
        const before = i >= 4 && [1, 2, 3, 4].every((k) => !get(i - k));
        const after = i + 11 <= s && [7, 8, 9, 10].every((k) => !get(i + k));
        if (before || after) p += 40;
      }
    }
  };
  for (let y = 0; y < s; y++) line((i) => g.dark[y][i]);
  for (let x = 0; x < s; x++) line((i) => g.dark[i][x]);
  for (let y = 0; y < s - 1; y++) for (let x = 0; x < s - 1; x++) {
    const c = g.dark[y][x];
    if (c === g.dark[y][x + 1] && c === g.dark[y + 1][x] && c === g.dark[y + 1][x + 1]) p += 3;
  }
  const dark = g.dark.reduce((n, row) => n + row.filter(Boolean).length, 0);
  const total = s * s;
  p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return p;
}

export type QrCode = { version: number; size: number; mask: number; modules: boolean[][]; codewords: number[] };

/** Encodes text (UTF-8, byte mode, level M). Throws when it does not fit version 10. */
export function encodeQr(text: string): QrCode {
  const bytes = utf8(text);
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) if (4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  if (ver > MAX_VERSION) throw new Error('Text is too long for a QR code here');
  const size = ver * 4 + 17;
  const g: Grid = { size, dark: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)), fn: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)) };
  drawFunctionPatterns(g, ver);
  const codewords = withEcc(dataFor(bytes, ver), ver);
  placementOrder(g).forEach(([x, y], i) => { g.dark[y][x] = i < codewords.length * 8 && bit(codewords[i >>> 3], 7 - (i & 7)); });
  let best = 0; let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(g, m); drawFormat(g, m);
    const sc = penalty(g);
    if (sc < bestScore) { bestScore = sc; best = m; }
    applyMask(g, m);
  }
  applyMask(g, best); drawFormat(g, best);
  return { version: ver, size, mask: best, modules: g.dark, codewords };
}

/** One SVG path ("M x y h1 v1 h-1 z" per dark module), for a viewBox of size + 2 × quiet zone. */
export function toSvgPath(qr: QrCode, quiet = 4): string {
  const parts: string[] = [];
  qr.modules.forEach((row, y) => row.forEach((d, x) => { if (d) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`); }));
  return parts.join('');
}
