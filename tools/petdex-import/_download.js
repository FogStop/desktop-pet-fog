const fs = require('fs');
const path = require('path');
const pkg = __dirname;

const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'manifest.json'), 'utf8'));
const pets = manifest.pets;

// Cute-first keyword filter, applied to slug (ASCII, reliable) and displayName.
const CUTE = [
  'neko','nyan','meow','cat','kitten','kitty','bunny','rabbit','duck','chick',
  'bird','corgi','capybara','shiba','puppy','pup','dog','bear','fox','hamster',
  'mouse','pig','frog','sheep','cow','deer','star','cloud','ghost','slime','egg',
  'angel','chibi','kawaii','cute','mochi','boba','toast','sleepy','happy','smile',
  'panda','penguin','fish','whale','cat','bnuuy','usagi','kuma','neko','tanuki','otter'
];
const rx = new RegExp('(' + CUTE.join('|') + ')', 'i');

// Pick a diverse spread: limit per keyword so 128 cats don't dominate.
const perKw = {};
const MAX_PER_KW = 2;
const chosen = [];
const seen = new Set();
for (const p of pets) {
  if (chosen.length >= 16) break;
  const hay = (p.slug || '') + ' ' + (p.displayName || '');
  const m = hay.match(rx);
  if (!m) continue;
  const kw = m[1].toLowerCase();
  perKw[kw] = (perKw[kw] || 0) + 1;
  if (perKw[kw] > MAX_PER_KW) continue;
  if (seen.has(p.slug)) continue;
  seen.add(p.slug);
  chosen.push({ pet: p, kw });
}

console.log('CHOSEN', chosen.length);
for (const c of chosen) console.log(`  [${c.kw}] ${c.pet.displayName} :: ${c.pet.slug}`);

const dir = pkg;
async function dl(url, dest, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return buf.length;
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  let ok = 0, fail = 0;
  for (const c of chosen) {
    const slug = c.pet.slug;
    const out = path.join(dir, slug);
    fs.mkdirSync(out, { recursive: true });
    try {
      const a = await dl(c.pet.spritesheetUrl, path.join(out, 'sprite.webp'));
      const b = await dl(c.pet.petJsonUrl, path.join(out, 'petjson.json'));
      console.log(`OK  ${slug}  sprite=${Math.round(a/1024)}KB petjson=${Math.round(b/1024)}KB`);
      ok++;
    } catch (e) {
      console.log(`FAIL ${slug}  ${e.message}`);
      fail++;
    }
  }
  console.log(`DONE ok=${ok} fail=${fail} total=${chosen.length}`);
})();
