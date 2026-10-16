/**
 * Petdex spritesheet -> dsh-pet skin webm converter.
 * Baseline (probed from working ouo-neko skin): VP8 + alpha_mode=1, 192x208, 25fps.
 * Petdex v1 grid: 8 cols x 9 rows, frame 192x208. Canonical frames/row:
 *   [6,8,8,4,5,8,6,6,6] — auto-verified per row via blank-cell (tiny PNG) detection.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FF = 'C:\\Users\\27552\\.workbuddy\\binaries\\node\\workspace\\node_modules\\ffmpeg-static\\ffmpeg.exe';
const PKG = __dirname;
const OUT = path.join(PKG, '..', 'skins');

const FW = 192, FH = 208, COLS = 8;
// row, canonical frames, hold ticks @25fps, dsh-pet animation name
const ROWS = [
  { row: 0, canon: 6, hold: 11, name: '待机呼吸休闲' },         // idle
  { row: 1, canon: 8, hold: 3,  name: '螃蟹走路' },             // running-right
  { row: 2, canon: 8, hold: 3,  name: '原地漂浮踏步' },         // running-left
  { row: 3, canon: 4, hold: 7,  name: '女仆屈膝礼仪' },         // waving
  { row: 4, canon: 5, hold: 5,  name: '原地跳跃抓碎头顶物品' }, // jumping
  { row: 5, canon: 8, hold: 4,  name: '打瞌睡被惊醒' },         // failed
  { row: 6, canon: 6, hold: 11, name: '原地小憩沉眠' },         // waiting
  { row: 7, canon: 6, hold: 4,  name: '原地左转奔跑' },         // running
  { row: 8, canon: 6, hold: 6,  name: '深度思考碎碎念' },       // review
];
const BLANK_BYTES = 400; // fully-transparent 192x208 png compresses to ~100-300 bytes

function detectFrames(sizes, canon) {
  // count leading non-blank cells; never below 2, never above 8
  let n = 0;
  while (n < COLS && sizes[n] >= BLANK_BYTES) n++;
  if (n < 2) return canon; // detection failed -> trust canonical
  return n;
}

const PROGRESS = path.join(__dirname, 'progress.txt');
fs.writeFileSync(PROGRESS, 'start');
function mark(s) { fs.appendFileSync(PROGRESS, '\n' + s); }

function convertPet(slug) {
  mark(`convertPet:${slug}:begin`);
  const dir = path.join(PKG, slug);
  const sprite = path.join(dir, 'sprite.webp');
  if (!fs.existsSync(sprite)) throw new Error('sprite.webp missing');
  const tmp = path.join(dir, 'cells');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const outDir = path.join(OUT, slug + '-animation');
  fs.mkdirSync(outDir, { recursive: true });

  let label = slug;
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'petjson.json'), 'utf8'));
    if (pj.displayName) label = pj.displayName;
  } catch {}

  // 1) extract all 72 cells in one ffmpeg call (split -> crop -> multiple outputs)
  const n = COLS * ROWS.length;
  const splitTargets = Array.from({ length: n }, (_, i) => `[s${i}]`).join('');
  const parts = [`[0:v]split=${n}${splitTargets}`];
  const maps = [];
  let idx = 0;
  const cellPath = [];
  for (const r of ROWS) {
    for (let c = 0; c < COLS; c++) {
      const p = path.join(tmp, `c${String(idx).padStart(2, '0')}.png`);
      cellPath.push(p);
      parts.push(`[s${idx}]crop=${FW}:${FH}:${c * FW}:${r.row * FH}[f${idx}]`);
      maps.push('-map', `[f${idx}]`, p);
      idx++;
    }
  }
  execFileSync(FF, ['-y', '-i', sprite, '-filter_complex', parts.join(';'), ...maps], { stdio: 'ignore' });
  mark(`convertPet:${slug}:cells-extracted`);

  // 2) per row: detect real frame count, sequence-copy, encode
  const notes = [];
  idx = 0;
  for (const r of ROWS) {
    const sizes = [];
    for (let c = 0; c < COLS; c++) {
      sizes.push(fs.statSync(cellPath[idx + c]).size);
    }
    const frames = detectFrames(sizes, r.canon);
    notes.push(`row${r.row}:${frames}f(can${r.canon})`);
    // CRITICAL: clear stale seq files from previous row, or ffmpeg reads them too
    for (const f of fs.readdirSync(tmp)) if (f.startsWith('seq_')) fs.unlinkSync(path.join(tmp, f));
    for (let c = 0; c < frames; c++) {
      fs.copyFileSync(cellPath[idx + c], path.join(tmp, `seq_${String(c).padStart(3, '0')}.png`));
    }
    idx += COLS;
    const srcFps = (25 / r.hold).toFixed(5);
    execFileSync(FF, [
      '-y', '-framerate', srcFps, '-start_number', '0',
      '-i', path.join(tmp, 'seq_%03d.png'),
      '-c:v', 'libvpx', '-pix_fmt', 'yuva420p', '-r', '25',
      '-auto-alt-ref', '0', '-an', '-crf', '14', '-b:v', '2M',
      '-deadline', 'good', '-cpu-used', '3',
      path.join(outDir, r.name + '.webm'),
    ], { stdio: 'ignore' });
    mark(`convertPet:${slug}:row${r.row}-encoded(${frames}f)`);
  }
  // NOTE: do NOT rmSync the cells dir here — it hard-crashed node on some pets
  // (left in place; cleaned by _clean_cells.js if needed)
  mark(`convertPet:${slug}:done`);
  return { id: slug, label, notes };
}

const slugs = process.argv.slice(2);
if (slugs.length === 0) { console.error('usage: node _convert.js <slug>...'); process.exit(1); }
const registry = [];
const logLines = [];
function log(s) { logLines.push(s); }
for (const slug of slugs) {
  try {
    const res = convertPet(slug);
    const files = fs.readdirSync(path.join(OUT, slug + '-animation'));
    const totalKB = files.reduce((s, f) => s + fs.statSync(path.join(OUT, slug + '-animation', f)).size, 0) / 1024;
    log(`OK  ${slug}  label="${res.label}"  files=${files.length}  total=${totalKB.toFixed(0)}KB  ${res.notes.join(', ')}`);
    registry.push(res);
  } catch (e) {
    log(`FAIL ${slug}  ${(e.stack || e.message).split('\n').slice(0, 3).join(' | ')}`);
  }
}
fs.writeFileSync(path.join(OUT, 'skins.json'), JSON.stringify(registry, null, 2));
log('REGISTRY WRITTEN: ' + path.join(OUT, 'skins.json'));
fs.writeFileSync(path.join(__dirname, 'convert-log.txt'), logLines.join('\n'));
console.log(logLines.join('\n'));
