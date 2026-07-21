// Gera os PNGs dos ícones a partir da marca da Dexterity: quatro "pétalas"
// (três grafite, a superior direita teal) com estrela negativa ao centro.
// Sem dependências. Uso: node icons/generate.mjs  (a partir da pasta da extensão)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling para suavizar as bordas

const DARK = [74, 75, 77]; // grafite da marca
const TEAL = [31, 158, 151]; // teal da marca

// ---------------------------------------------------------------------------
// Geometria: espaço de desenho 100 × 80 (proporção da marca). A metade
// inferior é o espelho vertical da superior; só a pétala sup. direita é teal.
// ---------------------------------------------------------------------------

const DESIGN_W = 100;
const DESIGN_H = 80;

function flattenCubic(from, c1, c2, to, steps = 48) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([
      u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
      u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1],
    ]);
  }
  return pts;
}

class Path {
  constructor(x, y) {
    this.pts = [[x, y]];
  }
  line(x, y) {
    this.pts.push([x, y]);
    return this;
  }
  cubic(c1x, c1y, c2x, c2y, x, y) {
    const from = this.pts[this.pts.length - 1];
    this.pts.push(...flattenCubic(from, [c1x, c1y], [c2x, c2y], [x, y]));
    return this;
  }
  done() {
    return this.pts; // o polígono fecha sozinho de volta ao ponto inicial
  }
}

// Pétala superior esquerda ("bandeira"): topo reto, diagonal à esquerda,
// canto inferior direito bem arredondado terminando na ponta.
const flag = new Path(5, 4)
  .line(50, 4)
  .line(50, 20)
  .cubic(50, 30.5, 40, 37.2, 28, 37.2)
  .done();

// Pétala superior direita ("folha"): esquerda vertical, curvão cheio no topo
// encostando na borda direita e descendo até a ponta inferior direita.
const leaf = new Path(55.5, 9)
  .cubic(55.5, 5.5, 58, 4, 61.5, 4)
  .line(73, 4)
  .cubic(84, 5, 93, 18.5, 95, 37)
  .cubic(83, 36.4, 70, 33.2, 63.5, 30.6)
  .cubic(58.5, 29.5, 55.5, 27, 55.5, 22.5)
  .done();

const mirrorY = (pts) => pts.map(([x, y]) => [x, DESIGN_H - y]);

function bboxOf(pts) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

const SHAPES = [
  { color: DARK, pts: flag },
  { color: TEAL, pts: leaf },
  { color: DARK, pts: mirrorY(flag) },
  { color: DARK, pts: mirrorY(leaf) },
].map((shape) => ({ ...shape, bbox: bboxOf(shape.pts) }));

function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function shapeAt(x, y) {
  for (const shape of SHAPES) {
    const [minX, minY, maxX, maxY] = shape.bbox;
    if (x >= minX && x <= maxX && y >= minY && y <= maxY && inPoly(shape.pts, x, y)) return shape;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rasterização e escrita do PNG
// ---------------------------------------------------------------------------

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

function render(size) {
  const scale = (size * 0.96) / DESIGN_W;
  const offX = size * 0.02;
  const offY = (size - DESIGN_H * scale) / 2;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = (x + (sx + 0.5) / SS - offX) / scale;
          const dy = (y + (sy + 0.5) / SS - offY) / scale;
          const shape = shapeAt(dx, dy);
          if (shape) {
            hits++;
            r += shape.color[0];
            g += shape.color[1];
            b += shape.color[2];
          }
        }
      }
      if (!hits) continue;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(r / hits);
      pixels[i + 1] = Math.round(g / hits);
      pixels[i + 2] = Math.round(b / hits);
      pixels[i + 3] = Math.round((hits / (SS * SS)) * 255);
    }
  }
  return pixels;
}

for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png(size, render(size)));
  console.log(`gerado ${file}`);
}
