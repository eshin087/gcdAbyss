import { ellipsoidGeometry } from '../../render/glyphGeometry.js';
import { mergeGeometries, sub, orient, orientTo, clumpGeometry, boxGeometry, limb } from './heroGeo.js';
import { DIM, BODY } from './heroDims.js';

// The hero's face and his hood-down hair (Session 20, ADR-063; owner: "the front of the face also
// needs to be more ascii art as it looks bad. make the hair and shade face more distinct and cooler
// looking. add an option to hide the hood so also make the hair look cool"; of three rendered
// previews, a shadowed face with glowing eyes, a lit face and a scarf mask, the owner picked the lit
// face, "B").
//
// The face is drawn by the ink-line art pass (render/pipeline.js): a part prints letters from its
// fill and draws an ink line wherever it meets another part or another sub-id. One smooth face part
// printed as a blank oval: the pale mannequin, and under the hood (where it went near-black) a hole.
// So the face is built from FEATURES, each a piece whose outline is the line that draws it: gold
// brows angled down toward the nose, dark almond eyes with a cyan glint (the blade's moonlight), the
// nose's ridge, a closed mouth, the jaw against the skull. Head space, before BODY.headScale: the
// skull is an ellipsoid of radii 0.078 / 0.1 / 0.09 (x / y / z) round DIM.skull, its front at
// z ≈ 0.095; the eyes sit at 1.65 m in the idle stance.
//
// buildHero's `look.face`: 'lit' builds this face (the player's); null keeps the plain face of
// before (other actors built on the hero's skeleton, like the Ash Disciple, are not changed).

const [SX, SY, SZ] = DIM.skull;

/** The lit face on `head` (through `mesh`: the body's own meshes): neck, skull, jaw, ear, features.
 *  The face stays lit under a hood that `shadowsFace` (the hood sits pushed back off the brow). */
export function buildFace(head, M, mesh) {
  const skin = M.skin;
  mesh(head, limb({ length: 0.12, r0: BODY.neck[0], r1: BODY.neck[1], radial: 8, rings: 2, capSegs: 1 }), skin, 0, 0.1, 0.0);
  mesh(head, orient.up(ellipsoidGeometry(0.078, 0.09, 0.1)), skin, SX, SY, SZ);
  // slim V-jaw with a pointed chin (chin at ~1.57 m); its own sub-id, so its edge against the skull
  // draws the jaw line and the cheek
  const jaw = ellipsoidGeometry(0.05, 0.04, 0.056, { widthSegs: 10, heightSegs: 6 });
  const jp = jaw.attributes.position;
  for (let i = 0; i < jp.count; i++) {
    const z = jp.getZ(i), y = jp.getY(i);
    const k = 1 - 0.45 * Math.max(0, z / 0.056) * Math.max(0, -y / 0.04 + 0.3);
    jp.setX(i, jp.getX(i) * k);
  }
  jaw.computeVertexNormals();
  mesh(head, sub(jaw, 1), skin, SX, SY - 0.066, SZ + 0.016);
  // the right ear shows below the swept-back locks
  mesh(head, ellipsoidGeometry(0.012, 0.024, 0.018, { widthSegs: 6, heightSegs: 4 }), skin, SX - 0.08, SY - 0.014, SZ - 0.008);

  const brows = [], dark = [], glints = [];
  for (const s of [-1, 1]) {
    // the brows: angled down toward the nose (a hard, level stare), following the brow's curve
    const b = boxGeometry(0.032, 0.0062, 0.008, 0, 0, 0);
    b.rotateZ(s * 0.24);
    b.rotateY(s * 0.38);
    b.translate(s * 0.033, 0.149, 0.086);
    brows.push(b);
    // the eyes: dark almonds, the outer corners a little raised
    const e = ellipsoidGeometry(0.0155, 0.0068, 0.006, { widthSegs: 10, heightSegs: 4 });
    e.rotateZ(s * 0.12);
    e.rotateY(s * 0.35);
    e.translate(s * 0.031, 0.127, 0.087);
    dark.push(e);
    // a cyan glint in each, toward the nose
    glints.push(ellipsoidGeometry(0.0042, 0.0042, 0.003, { widthSegs: 6, heightSegs: 4 }).translate(s * 0.028, 0.128, 0.0925));
  }
  // the mouth: a short closed line
  dark.push(boxGeometry(0.026, 0.0035, 0.006, 0, 0.085, 0.079));
  mesh(head, mergeGeometries(brows), M.hair);
  mesh(head, mergeGeometries(dark), M.eye);
  mesh(head, mergeGeometries(glints), M.bladeTip);
  // the nose: a narrow ridge down the middle of the face (its outline is the nose's line)
  mesh(head, sub(ellipsoidGeometry(0.0085, 0.02, 0.013, { widthSegs: 8, heightSegs: 6 }), 1), skin, 0, 0.111, 0.091);
}

/** Gold locks over the back of the head for the hood-down hair: the sculpted clusters (model.js,
 *  HAIR_CLUSTERS) cover the crown and the front, and from behind the scalp cap read bald. Each is
 *  [x, y, z of its root, direction x, y, z, length, half-width, curl] (head space); `sides` are
 *  mirrored. The tips flick out, away from the head. */
const HAIR_BACK = {
  centre: [[0, 0.232, -0.06, 0, -0.55, -0.85, 0.15, 0.032, 0.3], [0, 0.16, -0.088, 0, -0.85, -0.5, 0.12, 0.028, 0.38]],
  sides: [
    [0.04, 0.236, -0.05, 0.3, -0.5, -0.82, 0.15, 0.03, 0.32],
    [0.068, 0.214, -0.028, 0.62, -0.55, -0.55, 0.14, 0.028, 0.32],
    [0.078, 0.18, -0.01, 0.75, -0.62, -0.25, 0.12, 0.024, 0.34],
    [0.045, 0.158, -0.08, 0.38, -0.82, -0.45, 0.13, 0.026, 0.4],
    [0.072, 0.13, -0.05, 0.6, -0.78, -0.2, 0.11, 0.022, 0.4],
  ],
};

/** The hood-down hair's back locks on `head`: the root 45 % in the darker gold, the rest in the
 *  bright tips; neighbours alternate the sub-id, so a line parts them (strands, not one mass). */
export function buildHairBack(head, M, mesh) {
  const mass = [], tips = [];
  let k = 0;
  const lock = ([x, y, z, dx, dy, dz, L, w, curl], s) => {
    const out = [s * dx, 0, dz];
    for (const [t0, t1, list] of [[0, 0.45, mass], [0.45, 1, tips]]) {
      list.push(sub(orientTo(clumpGeometry(L, w, w * 0.45, { t0, t1, curl, taper: 0.75, cols: 6, rows: 2 }), [s * x, y, z], [s * dx, dy, dz], out), k & 1));
    }
    k++;
  };
  for (const l of HAIR_BACK.centre) lock(l, 1);
  for (const s of [-1, 1]) for (const l of HAIR_BACK.sides) lock(l, s);
  mesh(head, mergeGeometries(mass), M.hair);
  mesh(head, mergeGeometries(tips), M.hairTip);
}
