/**
 * Build a PREVIEW POOL of Petdex candidates so the user can visually pick the cute ones.
 * Downloads sprite.webp, extracts the idle frame (row0,col0 of the 8x9 grid) as a PNG tile,
 * and writes an HTML gallery (pool/gallery.html) numbered so picks can be named by number.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FF = 'C:\\Users\\27552\\.workbuddy\\binaries\\node\\workspace\\node_modules\\ffmpeg-static\\ffmpeg.exe';
const PKG = __dirname;
const POOL = path.join(PKG, 'pool');
fs.mkdirSync(POOL, { recursive: true });

const FW = 192, FH = 208;

// already used (installed 12 + downloaded-but-rejected 4) - never re-offer
const USED = new Set([
  'blue-button-bunny','lulu-capybara-2','little-deer','shiba-4','white-dog','circuit-pup',
  'bunnydeer','bilby-bird','daidai-bird-3','amy-chibi','panda-penguin','zichao-bear-2',
  'alder-catalog-foot','linen-catalog-foot','weeping-angel','chibi-gundam',
]);

const CUTE = [
  'neko','nyan','meow','cat','kitty','kitten','bunny','rabbit','usagi','bnuuy','duck','chick',
  'bird','owl','corgi','capybara','shiba','puppy','pup','dog','bear','kuma','fox','kitsune',
  'hamster','mouse','pig','frog','sheep','lamb','cow','calf','deer','panda','penguin','fish',
  'whale','otter','tanuki','axolotl','slime','ghost','angel','mochi','chibi','kawaii','cute',
  'sleepy','happy','smile','boba','toast','star','cloud','egg','squirrel','raccoon','ferret',
  'hedgehog','turtle','seal','walrus','chicken','goat','koala','sloth','tiger','lion',
  'elephant','dino','dragon','bat','wolf','crab','shrimp','snail','bee','butterfly','moth',
];
const rx = new RegExp('(' + CUTE.join('|') + ')', 'i');

const manifest = JSON.parse(fs.readFileSync(path.join(PKG, 'manifest.json'), 'utf8'));
const pets = manifest.pets;

// diverse spread: cap per keyword, skip objects (weird props read as "ugly"), skip used
const perKw = {};
const MAX_PER_KW = 4;
const WANT = 36;
const chosen = [];
const seen = new Set(USED);
for (const p of pets) {
  if (chosen.length >= WANT) break;
  if (!p.slug || seen.has(p.slug)) continue;
  if (p.kind === 'object') continue; // props / furniture -> not cute pets
  const hay = (p.slug || '') + ' ' + (p.displayName || '');
  const m = hay.match(rx);
  if (!m) continue;
  const kw = m[1].toLowerCase();
  perKw[kw] = (perKw[kw] || 0) + 1;
  if (perKw[kw] > MAX_PER_KW) continue;
  seen.add(p.slug);
  chosen.push({ pet: p, kw });
}

async function dl(url, dest, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return buf.length;
  } finally { clearTimeout(t); }
}

const log = [];
function L(s) { log.push(s); fs.writeFileSync(path.join(POOL, 'pool-log.txt'), log.join('\n')); }

(async () => {
  L('CANDIDATES ' + chosen.length);
  for (const c of chosen) L(`  [${c.kw}] ${c.pet.displayName} :: ${c.pet.slug}`);

  const items = [];
  for (const c of chosen) {
    const slug = c.pet.slug;
    const dir = path.join(PKG, slug);
    fs.mkdirSync(dir, { recursive: true });
    const sprite = path.join(dir, 'sprite.webp');
    let sizeKB = 0;
    if (!fs.existsSync(sprite)) {
      try { sizeKB = Math.round((await dl(c.pet.spritesheetUrl, sprite)) / 1024); }
      catch (e) { L(`DL-FAIL ${slug} ${e.message}`); continue; }
    } else { sizeKB = Math.round(fs.statSync(sprite).size / 1024); }

    // display name from petjson (some are mojibake; fall back to slug)
    let label = c.pet.displayName || slug;
    const pjPath = path.join(dir, 'petjson.json');
    if (!fs.existsSync(pjPath)) { try { await dl(c.pet.petJsonUrl, pjPath); } catch {} }
    try {
      const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
      if (pj.displayName && !/[\uFFFD]/.test(pj.displayName)) label = pj.displayName;
    } catch {}

    // extract idle frame (row0,col0)
    const tile = path.join(POOL, slug + '.png');
    try {
      execFileSync(FF, ['-y', '-i', sprite, '-vf', `crop=${FW}:${FH}:0:0`, tile], { stdio: 'ignore' });
    } catch (e) { L(`CROP-FAIL ${slug} ${e.message}`); continue; }

    let blank = false;
    try { blank = fs.statSync(tile).size < 400; } catch {}
    items.push({ slug, label: label || slug, kw: c.kw, sizeKB, blank });
    L(`OK ${slug} label="${label}" ${sizeKB}KB blank=${blank}`);
  }

  L('POOL ' + items.length);
  fs.writeFileSync(path.join(POOL, 'pool.json'), JSON.stringify(items, null, 2));

  // ---- HTML gallery ----
  const cards = items.map((it, i) => `
    <div class="card${it.blank ? ' blank' : ''}">
      <div class="thumb"><img src="${it.slug}.png" alt="${it.slug}"></div>
      <div class="meta">
        <span class="num">#${i + 1}</span>
        <span class="name">${it.label}</span>
        <span class="slug">${it.slug}</span>
      </div>
    </div>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>Petdex 形象候选池</title>
<style>
  :root { --bg:#f5f6f8; --card:#ffffff; --line:#e3e6ea; --text:#1f2328; --dim:#6a737d; --accent:#2f81f7; }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px 28px 48px; background:var(--bg); color:var(--text);
         font:14px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
  h1 { font-size:19px; margin:0 0 6px; }
  .sub { color:var(--dim); font-size:13px; margin-bottom:20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(178px,1fr)); gap:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:10px; text-align:center; }
  .card.blank { opacity:.45; }
  .thumb { background:
      linear-gradient(45deg,#e9ecf0 25%,transparent 25%,transparent 75%,#e9ecf0 75%),
      linear-gradient(45deg,#e9ecf0 25%,transparent 25%,transparent 75%,#e9ecf0 75%);
      background-size:16px 16px; background-position:0 0,8px 8px; background-color:#fff;
      border-radius:8px; display:flex; align-items:center; justify-content:center; padding:6px; }
  .thumb img { width:100%; image-rendering:pixelated; display:block; }
  .meta { margin-top:8px; }
  .num { display:inline-block; background:var(--accent); color:#fff; border-radius:5px;
         padding:1px 6px; font-size:11px; font-weight:600; margin-right:5px; }
  .name { font-weight:600; font-size:13px; }
  .slug { display:block; color:var(--dim); font-size:11px; margin-top:2px; word-break:break-all; }
</style></head><body>
<h1>Petdex 形象候选池</h1>
<div class="sub">共 ${items.length} 只候选（像素风）。看中哪几只，直接把<b>编号</b>（如 #3 #7 #12）或名字告诉我，我把它们做成形象替换掉现在那 12 只。灰色半透明 = 该精灵首帧是空白格，已排除。</div>
<div class="grid">
${cards}
</div>
</body></html>`;
  fs.writeFileSync(path.join(POOL, 'gallery.html'), html);
  L('GALLERY ' + path.join(POOL, 'gallery.html'));
  L('DONE');
})();
