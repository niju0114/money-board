/* 앱 아이콘(PNG) 생성 — 외부 의존성 없이 실행: npm run icons */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const BG = [0x34, 0xc7, 0x59]; // #34C759 포인트 그린
const FG = [0xff, 0xff, 0xff]; // 흰 글리프

/* ── PNG 인코딩 (8bit RGBA, 필터 없음) ── */
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}
function encodePNG(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── ₩ 글리프 — public/favicon.svg와 같은 64×64 좌표계 ── */
const W_PTS = [[16, 21], [24, 43], [32, 23], [40, 43], [48, 21]];
const BARS = [
  [13, 28.5, 51, 28.5],
  [13, 35.5, 51, 35.5],
];
const STROKE = 4.2;

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function render(size, { rounded, glyphScale }) {
  const u = size / 64;
  const segs = [];
  for (let i = 0; i < W_PTS.length - 1; i++) segs.push([...W_PTS[i], ...W_PTS[i + 1]]);
  segs.push(...BARS);
  // 글리프를 중심(32,32) 기준으로 축소한 뒤 픽셀 좌표로 변환
  const px = segs.map((s) => s.map((v) => (32 + (v - 32) * glyphScale) * u));
  const half = (STROKE * glyphScale * u) / 2;
  const r = size * 0.2235;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      let bgA = 1;
      if (rounded) {
        const dx = Math.abs(cx - size / 2) - (size / 2 - r);
        const dy = Math.abs(cy - size / 2) - (size / 2 - r);
        bgA = clamp01(0.5 - (Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r));
      }
      let cov = 0;
      for (const [x1, y1, x2, y2] of px) {
        cov = Math.max(cov, clamp01(half - segDist(cx, cy, x1, y1, x2, y2) + 0.5));
        if (cov >= 1) break;
      }
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(BG[0] + (FG[0] - BG[0]) * cov);
      rgba[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * cov);
      rgba[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * cov);
      rgba[i + 3] = Math.round(bgA * 255);
    }
  }
  return rgba;
}

const targets = [
  ["pwa-192.png", 192, { rounded: true, glyphScale: 1 }],
  ["pwa-512.png", 512, { rounded: true, glyphScale: 1 }],
  ["maskable-512.png", 512, { rounded: false, glyphScale: 0.72 }],
  ["apple-touch-icon.png", 180, { rounded: false, glyphScale: 0.9 }],
];
for (const [name, size, opts] of targets) {
  const png = encodePNG(size, render(size, opts));
  writeFileSync(join(OUT, name), png);
  console.log(`${name} (${size}x${size}, ${png.length.toLocaleString()} bytes)`);
}
