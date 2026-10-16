const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const PKG = __dirname;
const FF = 'C:\\Users\\27552\\.workbuddy\\binaries\\node\\workspace\\node_modules\\ffmpeg-static\\ffmpeg.exe';
const SLUGS = ['blue-button-bunny','lulu-capybara-2','little-deer','shiba-4','white-dog','circuit-pup','bunnydeer','bilby-bird','daidai-bird-3','amy-chibi','panda-penguin','zichao-bear-2'];
const FW = 192, FH = 208;
const frames = [];
for (const s of SLUGS) {
  const out = path.join(PKG, s, 'idle.png');
  execFileSync(FF, ['-y', '-i', path.join(PKG, s, 'sprite.webp'), '-vf', `crop=${FW}:${FH}:0:0`, '-frames:v', '1', out], { stdio: 'ignore' });
  frames.push(out);
}
// label strip: 4 cols x 3 rows
const rows = [];
for (let r = 0; r < 3; r++) {
  const ins = [0,1,2,3].map(c => `[${r*4+c}p]`).join('');
  rows.push(`${ins}hstack=inputs=4[r${r}]`);
}
const filter = frames.map((f,i)=>`[${i}:v]scale=${FW}:${FH}[${i}p]`).join(';') + ';' + rows.join(';') + ';[r0][r1][r2]vstack=inputs=3';
execFileSync(FF, ['-y', ...frames.flatMap(f=>['-i',f]), '-filter_complex', filter, '-frames:v','1', path.join(PKG,'..','skins','all-skins-preview.png')], { stdio: 'ignore' });
console.log('WROTE all-skins-preview.png');
