// The web build is the lite edition (src/edition.ts): after `vite build`, drop what only the Windows app uses so the
// site stays light and the full game stays a download. The desktop packager (desktop/build.mjs) runs `vite build`
// itself and keeps everything.
//   - anim/            the clip library and first-person clips (the web edition animates procedurally)
//   - env/pbr/, fx/    CC0 map surfaces + HDRIs and gunfire sprites (desktop rendering)
//   - sfx/             the recorded sound bank and voice lines (the web edition synthesises its sounds)
//   - Gantetsu, Hibiki, Tomoe, Hayate, Seiran (desktop roster)
//   - the new maps     props, skies, textures, key art for Hanabi Harbor, Cloudstep Terraces, Kagura Avenue,
//                      Sakura Lantern District, Starfall Observatory, Dawnforge Foundry
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'dist');
const FULL_MAPS = ['hanabi', 'cloudstep', 'kagura', 'lantern', 'starfall', 'foundry', 'mile', 'gulch'];
const FULL_HEROES = ['gantetsu', 'hibiki', 'tomoe', 'hayate', 'seiran'];
// generated weapon props of desktop-only heroes
const HERO_PROPS = ['prop_tomoe_', 'prop_hayate_', 'prop_seiran_', 'prop_gantetsu_', 'prop_chain_', 'prop_hex_'];
const PROP_PREFIX = { hanabi: 'prop_hanabi_', cloudstep: 'prop_cloud_', kagura: 'prop_kagura_', lantern: 'prop_lantern_', starfall: 'prop_star_', foundry: 'prop_forge_', mile: 'prop_mile_', gulch: 'prop_gulch_' };

let bytes = 0, files = 0;
const rm = p => {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p)) rm(path.join(p, f)); fs.rmdirSync(p); return; }
  bytes += st.size; files++; fs.rmSync(p);
};
const each = (dir, test) => { const d = path.join(DIST, dir); if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (test(f)) rm(path.join(d, f)); };

rm(path.join(DIST, 'anim'));
rm(path.join(DIST, 'sfx'));
// the desktop edition's CC0 surfaces + HDRIs (env/pbr, ~55 MB) and gunfire sprites (fx): the web edition paints its
// arenas with the generated textures and the studio-room lighting
rm(path.join(DIST, 'env', 'pbr'));
rm(path.join(DIST, 'fx'));
each('models', f => FULL_HEROES.some(h => f.startsWith(h + '.') || f.startsWith(h + '_')) || [...Object.values(PROP_PREFIX), ...HERO_PROPS].some(p => f.startsWith(p)));
each('env', f => FULL_MAPS.some(m => f.includes(`_${m}`)));
each('img', f => FULL_MAPS.some(m => f === `map_${m}.webp`) || FULL_HEROES.some(h => f.includes(h)));

// the model manifest must not point the web build at files that are gone
const man = path.join(DIST, 'models', 'manifest.json');
if (fs.existsSync(man)) {
  const j = JSON.parse(fs.readFileSync(man, 'utf8'));
  const gone = k => FULL_HEROES.some(h => k === h || k.startsWith(h + '_')) || [...Object.values(PROP_PREFIX), ...HERO_PROPS].some(p => k.startsWith(p));
  for (const sect of Object.values(j)) if (sect && typeof sect === 'object' && !Array.isArray(sect)) for (const k of Object.keys(sect)) if (gone(k)) delete sect[k];
  if (Array.isArray(j.textures)) j.textures = j.textures.filter(t => !FULL_MAPS.some(m => t.includes(`_${m}`)));
  fs.writeFileSync(man, JSON.stringify(j, null, 2));
}
console.log(`lite-strip: removed ${files} desktop-only files (${(bytes / 1048576).toFixed(1)} MB) from dist/`);
