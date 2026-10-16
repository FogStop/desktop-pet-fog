const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pkg = __dirname;
const ff = "C:\\Users\\27552\\.workbuddy\\binaries\\node\\workspace\\node_modules\\ffmpeg-static\\ffmpeg.exe";

// Build a 3x3 contact sheet: middle frame of each of the 9 rows, for one pet.
const slug = process.argv[2] || 'blue-button-bunny';
const dir = path.join(pkg, slug);
const sprite = path.join(dir, 'sprite.webp');
const FW = 192, FH = 208, COLS = 8, ROWS = 9;

const frames = [];
for (let r = 0; r < ROWS; r++) {
  const out = path.join(dir, `row_${r}.png`);
  // petdex sprite.webp is a SINGLE still spritesheet (not animated). Crop frame 0 of each row.
  const x = 0;
  const y = r * FH;
  execFileSync(ff, [
    '-y', '-i', sprite,
    '-vf', `crop=${FW}:${FH}:${x}:${y},scale=${FW}:${FH}`,
    '-frames:v', '1', out
  ], { stdio: 'ignore' });
  frames.push(out);
}

// tile 3x3
const tileW = FW, tileH = FH;
const pad = 6;
const W = 3 * tileW + 4 * pad;
const H = 3 * tileH + 4 * pad;
const filter = frames.map((f, i) => {
  const cx = pad + (i % 3) * (tileW + pad);
  const cy = pad + Math.floor(i / 3) * (tileH + pad);
  return `[${i}:v]pad=${W}:${H}:${cx}:${cy}:color=0x222222ff[${i}p]`;
}).join(';');
// chain pads
let chain = '[0p]';
for (let i = 1; i < 9; i++) { chain += `[${i}p]`; if (i < 8) chain += 'overlay=0:0'; chain += `[${i}o];`; }
// simpler: use hstack/vstack via 3 rows then vstack
const rowStacks = [];
for (let row = 0; row < 3; row++) {
  const inputs = [0,1,2].map(c => `[${row*3+c}p]`).join('');
  rowStacks.push(`${inputs}hstack=inputs=3[r${row}]`);
}
const vstack = `[r0][r1][r2]vstack=inputs=3`;
const finalFilter = frames.map((f,i)=>`[${i}:v]scale=${FW}:${FH}[${i}p]`).join(';') + ';' + rowStacks.join(';') + ';' + vstack;
execFileSync(ff, [
  '-y', ...frames.flatMap(f => ['-i', f]),
  '-filter_complex', finalFilter,
  '-frames:v', '1', path.join(dir, 'contactsheet.png')
], { stdio: 'ignore' });
console.log('WROTE', path.join(dir, 'contactsheet.png'));
