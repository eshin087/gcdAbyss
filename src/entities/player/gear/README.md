# Hero gear

What the hero wears is data. `model.js` builds the skeleton and the body (neck, head, face, ears,
eyes, hair, the flask); everything else is an **item** in an **equipment slot**, and a **loadout**
says which item sits in which slot.

```js
import { buildHero } from '../model.js';
import { DEFAULT_LOADOUT } from './index.js';

buildHero(U);                                             // the Shrouded set (DEFAULT_LOADOUT)
buildHero(U, WANDERER_LOADOUT);                           // the greatcoat, pauldron and half-cape
buildHero(U, { ...DEFAULT_LOADOUT, back: null });         // the default without the cloak
buildHero(U, { ...DEFAULT_LOADOUT, chest: 'my.plate' });  // another chest piece
buildHero(U, {});                                         // the plain undersuit, no weapon
```

| File | What it holds |
| --- | --- |
| `index.js` | `SLOTS`, the `GEAR` registry, `registerItem`, `getItem`, `DEFAULT_LOADOUT`, `WANDERER_LOADOUT`, `BASE_LOADOUT`, `resolveLoadout` |
| `shroud.js` | the Shrouded set (the default since ADR-043): hood, wrap tunic, bound sleeves, the tattered cloak (`SHROUD_SHEETS`). Built from `heroGeo.js` sheets only, no sculpted parts |
| `wanderer.js` | the Wanderer's set, one item per slot, plus its data (`COAT_PANELS`, `CAPE_SHEETS`). Its legs, coat tails and sword are part of the default loadout |
| `base.js` | the undersuit: fallback items for `chest`, `arms`, `legs` |
| `../heroGeo.js` | the geometry builders every item is made of |
| `../heroDims.js` | `DIM`, `BODY`, `REST`, `HAIR_CLUSTERS` (the body's measurements) |

## Slots

Built in this order. The body is never bare: a loadout that leaves `chest`, `arms` or `legs` empty
gets the `base.*` item for it. Any other slot may be empty.

| Slot | Covers | Hangs on | Default item |
| --- | --- | --- | --- |
| `head` | helmets, hoods, masks. Hair, face and neck are the body, not gear; an item with `hidesHair: true` leaves the hair out | `head` | `shroud.hood` |
| `chest` | the torso from the hips' top (1.09 m) to the collar: shell, shirt, buttons, belts, baldric, lapels, collar, yoke, emblem | `spine`, `chest` | `shroud.tunic` |
| `shoulders` | shoulder armour: the pauldron on its own joint, and any lames riding on the upper arms | `pauldron`, `arms.R.upper`, `arms.L.upper` | none (`wanderer.pauldron` in the Wanderer's set) |
| `arms` | both arms from the shoulder joint to the hand: sleeves, deltoid caps, vambrace / bracer, gauntlet / glove (the hands), elbow and wrist points. The SWORD hand's fist (`gripFist`) hangs on the `sword` joint, the grip's own frame, so it closes round the grip in every pose; it belongs to this slot, not to `weapon` | `arms.{R,L}.{upper,fore}`, `sword` (the fist) | `shroud.arms` |
| `legs` | hips, thighs, shins, feet, and what is strapped to them: hip straps, knee straps, boots, greaves, knee guards | `pelvis`, `legs.{R,L}.{thigh,shin,foot}` | `wanderer.legs` |
| `waist` | cloth hanging from the belt line: skirt panels, tassets | `pelvis` | `wanderer.skirt` |
| `back` | cloaks and capes | `chest`, and `arms.{R,L}.upper` for sheets draped over an arm | `shroud.cloak` |
| `weapon` | the weapon in the right hand: blade, grip, guard, pommel, gem | `sword` | `wanderer.sword` |

`arms` and `legs` own the limb itself (there is no skin mesh under the sleeves or the pants), so an
item for those slots must draw the whole limb, hands and feet included. `chest` likewise owns the
torso surface.

## Adding an item

1. Write it (in a new file here, one file per set):

   ```js
   import { limb, sub } from '../heroGeo.js';

   export const MY_ITEMS = [{
     id: 'my.sleeves',          // unique, '<set>.<piece>'
     slot: 'arms',              // one of SLOTS
     name: 'Plain Sleeves',     // display name (UI, later)
     build({ arms, M, DIM, BODY, mesh }) {
       for (const s of ['R', 'L']) {
         mesh(arms[s].upper, sub(limb({ length: DIM.upperArm, r0: BODY.upperArm[0], r1: BODY.upperArm[1] }), 1), M.shirt);
         // ... forearm, hand
       }
     },
   }];
   ```

2. Register it: add its list to the `registerItem` loop in `index.js` (or call
   `registerItem(item)` yourself before the hero is built).
3. Put its id in a loadout. `buildHero` throws on an id that is not registered and on an item
   placed in a slot other than its own.

### `build(ctx)`

`ctx` holds

- the skeleton joints: `root, body, pelvis, spine, chest, head, arms.{R,L}.{upper,fore},
  legs.{R,L}.{thigh,shin,foot}, pauldron, sword`. Read-only: hang things on them, never move,
  rotate, scale or re-parent them (the animator owns their transforms).
- `M`: the hero materials (`createHeroMaterials` in `model.js`), by name.
- `DIM`, `BODY`, `REST`: bone lengths and joint offsets, girth, and the idle height of each joint
  (`h - REST.spine` turns a height above the ground into a `spine`-local y).
- `mesh(parent, geometry, material, x, y, z)` and `joint(parent, x, y, z)`: create a mesh / a
  joint of your own under `parent`. **Create everything through these two.** They tag what you
  add with `userData.slot`, which is how the rig knows what belongs to your slot.
- `slot`, `item`: the slot being built and the item itself (for an item's own data, like a
  weapon's `dims`).

Axes: the hero faces +Z, Y is up, his RIGHT is −X. Limb joints point down −Y: the upper arm runs
from `y = 0` to `−DIM.upperArm`, the forearm to `−DIM.foreArm` (the grip centre), the thigh to
`−DIM.thigh`, the shin to `−DIM.shin`; the foot joint is the ankle, `DIM.ankle` above the sole. The
weapon joint's origin is the grip centre, the blade runs along +Z with its flats facing ±Y.
The `head` joint is scaled by `BODY.headScale`, so head gear is modelled at 1.0 and grows with it.

`build` may return handles the animator and the player need:

| Handle | From | Shape |
| --- | --- | --- |
| `coat` | `waist` | array of panels `{ anchor, segs: [upper, lower], def, strips, len: [upper, lower], r0 }` (below) |
| `streamers` | `back` | array of `{ segs: [root, tip], len: [l0, l1], out, lag?, max? }` (below) |
| `gem` | `weapon` | an Object3D on the weapon whose world position is where the gem glows |
| `flask` | any | a mesh shown only while he drinks (the animator sets its `visible` and `scale`) |
| `keep` | any | meshes of yours that must not be merged (see "Merging") |

Handles left out default to what an empty slot means: `coat: []`, `streamers: []`, a `gem` marker
on the weapon joint at `DIM.gem`, and the body's own flask in the left hand. `coat` and `streamers`
from several items are concatenated.

## What the look needs

- **Glyph materials only.** Every mesh uses a material from `M`. No plain shaded meshes (see
  `docs/STYLE.md`). A new material needs an entry in `HERO_INK` and a spec in
  `createHeroMaterials` (`model.js`); ink-line part ids are limited to `HERO_PARTS` (20, in
  `render/shaderLib.js`), and materials sharing a part id must share its ink settings.
- **Geometry attributes.** `position`, `normal` and `aGUV` (the glyph grid's coordinates, +y up
  the body so letters stand upright) are required; `aPart` (the ink-line sub-id) is added as 0 if
  missing. The builders in `heroGeo.js` and `render/glyphGeometry.js` set them. `sub(g, 1)` gives a
  piece the other sub-id, which draws an ink line where it meets a neighbour of the same material;
  `foldLines` draws creases.
- **Sculpted parts** come from `heroParts.js` through `partGeometry(key)`. That file is generated:
  a new sculpted part is added to `scripts/blender/hero_parts.py` and rebuilt with
  `npm run hero-parts` (Blender 4.2+, ADR-037). The script fits parts to `DIM / BODY / REST /
  HAIR_CLUSTERS / CAPE_SHEETS`, which it imports from `model.js`.

## Merging

After all items are built, static meshes that sit on the same joint, use the same material and
belong to the same slot are merged into one mesh (fewer draw calls). Body meshes merge only with
body meshes, and nothing merges across slots. So:

- do not keep a reference to a mesh you created and expect it to survive, unless you return it in
  `keep`;
- anything you animate or toggle goes on a joint of its own (`ctx.joint`) or in `keep`.

## What the animator assumes (`anim.js`)

The animator was written for the Wanderer's set. It reads the rig every frame, so these hold for
any item:

- **Skeleton.** Bone lengths and joint offsets come from `DIM`; gear cannot change them.
- **Body girth.** The blade's clearance from the legs (`BLADE_CLEAR`), the push of the legs on the
  coat (`LEG_R`) and the ground clamps are sized from `BODY` and `DIM`, not from the gear. Armour
  much thicker than the body will be clipped by the blade and the coat.
- **Shoulder armour** on the `pauldron` joint follows the right arm by a fixed share
  (`PAULDRON_FOLLOW`). The joint sits over the RIGHT shoulder only; there is no left one yet.
- **Coat panels** (`coat`). Each panel is `anchor` (a joint on the `pelvis`, yawed to `def.az`,
  local +Z outward) → `segs[0]` → `segs[1]` → `strips[k].joint`, exactly two segments.
  `def` needs `az`, `w: [top, join, hem]`, `len: [upper, lower]`, and may set `flare`, `skew`,
  `flap`; `len` is the pair of spring lengths, `r0` the anchor's distance from the pelvis axis;
  each strip is `{ joint, len, rest, phase }`. The idle breeze has per-panel values for the first
  six panels (`IDLE_FLARE`); later ones get none. `COAT_PANELS` in `wanderer.js` is the worked
  example.
- **Streamers** (`streamers`). Two-segment springs: `segs[0]` at the root, `segs[1]` at
  `−len[0]` below it; `out` is the resting outward flare; `lag` (default 1) scales how far the
  sheet trails the motion: 1 is a light ribbon that streams out level at a run, the cloak uses 0.5;
  `max` (default 2.6 rad) is how far a segment may swing from hanging, the cloak uses 1.45.
  The root may hang on any joint (the cloak drapes one sheet over each upper arm); the springs have
  no collision, so keep sheets off the sword arm's side or short there.
- **The arms.** `_arm` compresses the last fifth of each arm's reach (ADR-044), so a hand target at
  full stretch is reached with the elbow bent ~35°: model sleeves and hands for a bent arm, and do
  not rely on a pose locking the elbow.
- **The weapon.** The animator's ground clamp and blade-in-body checks (`steelTip`, `forte`,
  `drawnTip`), the hit segment in `combat.js` (`bladeBase`, `bladeTip`) and the sword FX in `fx.js`
  (`forte`, `drawnTip`) read the sword's numbers from `DIM`. The weapon item carries a copy of
  them in `dims` (`gripBack, guard, gem, forte, steelTip, drawnTip, bladeBase, bladeTip`) and
  builds its own geometry from it, but nothing else reads the copy yet: a weapon of another length
  would be drawn at its own size while it is swung, clamped and hit-tested as the longsword. The
  poses were authored for this sword in the right hand.
- **Empty slots.** `coat: []` and `streamers: []` are fine. Without a weapon the sword joint is
  still posed and attacks still hit (the hit segment is `DIM`'s); only the mesh is gone.

## The rig

`buildHero` returns the rig `anim.js` and `player.js` use, plus

- `rig.loadout`: slot → the id of the item built there, `null` for an empty slot (fallbacks show
  as their `base.*` id);
- `rig.slots`: slot → the Object3Ds that slot hung on the skeleton (top level only: each one's
  subtree is the slot's too, and every object in it has `userData.slot`).

## Next steps (not built yet)

- **Cheaper swapping.** Runtime swapping exists: `player.equip(slot, id | null)` and
  `player.setLoadout(loadout)` (`player.js`) rebuild the WHOLE rig under the same root and recreate
  the animator, so the pose restarts from the ready stance (equip out of combat). A per-slot swap
  (remove `rig.slots[slot]`, dispose, build that one item, re-merge) that keeps the animator and
  only rebuilds its coat / strip / streamer spring state is not built.
- **Weapons of other sizes.** `anim.js`, `combat.js` and `fx.js` read the sword's numbers from
  `DIM`; they should read the equipped weapon's `dims` (through the rig) instead, with `DIM` as the
  fallback for an empty hand.
- **Helmets.** `hidesHair: true` on a head item leaves all the hair out (the hood). Trimming
  only part of it under an open helm is not built.
- **Stats and inventory.** Items carry only `id`, `slot`, `name` and geometry today.
