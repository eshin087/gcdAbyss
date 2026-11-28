// Export today's hero (default outfit, no sword) in a T-pose as one OBJ, for Mixamo's auto-rigger.
// node scripts/mixamo/export-hero-obj.mjs <out.obj>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../../tests/integration/shim.mjs';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const THREE = await import('three');
const { buildHero } = await imp('src/entities/player/model.js');
const out = process.argv[2] || 'hero.obj';

const U = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (t[k] = { value: 0 })) });
const h = buildHero(U);
const root = h.root || h.group || h;
const skip = new Set(['weapon']);
const matKey = new Map(Object.entries(h.materials).map(([k, m]) => [m, k]));
// T-pose: upper arms straight out to the sides (the character's right is -X)
const arms = h.arms || h.joints?.arms;
if (arms) { arms.R.upper.rotation.set(0, 0, -Math.PI / 2); arms.L.upper.rotation.set(0, 0, Math.PI / 2); }
root.updateMatrixWorld(true);

let txt = '# gcd hero T-pose\n', vo = 1, nMesh = 0, nTri = 0;
const v = new THREE.Vector3();
root.traverse((o) => {
  if (!o.isMesh || !o.visible) return;
  let p = o, s = null; while (p) { if (p.userData?.slot) { s = p.userData.slot; break; } p = p.parent; }
  if (skip.has(s)) return;
  if (o.material && o.material.visible === false) return;
  const g = o.geometry; const pos = g.attributes.position; if (!pos) return;
  const mk = matKey.get(Array.isArray(o.material) ? o.material[0] : o.material) || 'coat';
  const part = g.attributes.aPart ? g.attributes.aPart.getX(0) : 0;
  txt += `o m${nMesh++}__${mk}__${part}__${s || 'body'}\n`;
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); txt += `v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}\n`; }
  const gu = g.attributes.aGUV;
  for (let i = 0; i < pos.count; i++) txt += gu ? `vt ${gu.getX(i).toFixed(4)} ${gu.getY(i).toFixed(4)}\n` : 'vt 0 0\n';
  const idx = g.index ? g.index.array : null; const n = idx ? idx.length : pos.count;
  const det = o.matrixWorld.determinant() < 0;
  for (let i = 0; i < n; i += 3) {
    const a = (idx ? idx[i] : i) + vo, b = (idx ? idx[i + 1] : i + 1) + vo, c = (idx ? idx[i + 2] : i + 2) + vo;
    txt += det ? `f ${a}/${a} ${c}/${c} ${b}/${b}\n` : `f ${a}/${a} ${b}/${b} ${c}/${c}\n`; nTri++;
  }
  vo += pos.count;
});
fs.writeFileSync(out, txt);
console.log(JSON.stringify({ mats: Object.keys(h.materials), meshes: nMesh, tris: nTri, verts: vo - 1, bytes: txt.length }));
