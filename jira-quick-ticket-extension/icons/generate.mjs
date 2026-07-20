// Gera os PNGs dos ícones (quadrado azul arredondado com "+" branco), sem dependências.
// Uso: node icons/generate.mjs   (a partir da pasta da extensão)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 32, 48, 128];
const BG = [0, 82, 204]; // azul Jira #0052CC
const FG = [255, 255, 255];
const SS = 4; // supersampling para suavizar as bordas

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "None" por linha
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function inRoundedRect(x, y, size) {
  const radius = size * 0.22;
  const half = size / 2;
  const dx = Math.max(Math.abs(x - half) - (half - radius), 0);
  const dy = Math.max(Math.abs(y - half) - (half - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function inPlus(x, y, size) {
  const half = size / 2;
  const arm = size * 0.3; // meia-extensão dos braços
  const thick = size * 0.1; // meia-espessura
  const dx = Math.abs(x - half);
  const dy = Math.abs(y - half);
  return (dx <= thick && dy <= arm) || (dy <= thick && dx <= arm);
}

for (const size of SIZES) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (inRoundedRect(px, py, size)) {
            bgHits++;
            if (inPlus(px, py, size)) fgHits++;
          }
        }
      }
      const alpha = bgHits / (SS * SS);
      const mix = bgHits ? fgHits / bgHits : 0;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(BG[0] + (FG[0] - BG[0]) * mix);
      pixels[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * mix);
      pixels[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * mix);
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png(size, pixels));
  console.log(`gerado ${file}`);
}
