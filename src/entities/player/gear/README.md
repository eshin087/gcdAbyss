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
| `index.js` | `SLOTS`, the `GEAR` registry, `registerItem`, `getItem`, `DEFAULT_LOADOUT`, `WANDERER_LOADOUT`, `BASE_LOADOUT`, `resolveLoadout`, `SWORD_PARAM` and `swordFromUrl()` (the `?sword=` pick, below) |
| `shroud.js` | the Shrouded set (the default since ADR-043): hood, wrap tunic, bound sleeves, the tattered cloak (`SHROUD_SHEETS`: a narrow cape down his back and a drape on each arm, ADR-073). Built from `heroGeo.js` sheets only, no sculpted parts |
| `wanderer.js` | the Wanderer's set, one item per slot, plus its data (`COAT_PANELS`, `CAPE_SHEETS`). Its legs, coat tails and sword are part of the default loadout |
| `base.js` | the undersuit: fallback items for `chest`, `arms`, `legs` |
| `moonblade.js` | the moon looks, for the owner's pick (2026-11-14): `moon.sheet` (the sheet's blade, built in code from a profile, `bladeGeometry(spec)`, on the longsword's swept guard with a silver rim round the pommel), `moon.ribbon` (the same with an unforked strip of the cloak's hem off the pommel: it echoes the Ash Disciple's tassel), `moon.crescent` (a silver crescent moon cradling the star gem in place of the swept quillons: it echoes the Starless Lord's crescents). `SWORD_LOOKS`, `SWORD_PARAM`, `MOONBLADE_ITEMS`. Each keeps the longsword's `dims` and its materials (part 17 flares). `?sword=today\|sheet\|ribbon\|crescent` (`swordFromUrl`, player.js) and the Lab's 'sword' row wear one. After the pick the winner becomes `wanderer.sword` (its build replaces `buildSword`) and the others, `SWORD_PARAM` and `swordFromUrl` go; a winner that is not today's also drops the `blade.*` parts from hero_parts.py / heroParts.js |
| `hands.js` | `buildFreeHand(ctx)`: the free hand every `arms` item that draws hands calls (one hand for every outfit) |
| `sheet.js` | `hangSheet(ctx, parent, d, mats)`: one cloth sheet or ribbon on the streamer springs, from data; `panelSkirt(ctx, PANELS, { seed })`: a skirt of coat panels on the pelvis |
| `looks.js` | the outfit options (kept for later use: the owner, 2026-11-14, keeps today's look as the default): `HERO_LOOKS` (id → `{ id, name, loadout, tint, of? }`; each new look also as `<id>-shade`, its face in shadow, `of` = the lit look), `LOOK_IDS`, `DEFAULT_LOOK`, `getLook`, `heroLookFromSearch`, `heroLookUrl`. Read by `main.js` (`?heroLook=`) and `player.js`; nothing in `gear/` imports it |
| `ref11.js` | the owner's costume reference 11 as an outfit option (ADR-291, `?heroLook=ref11`, Lab OUTFIT "Costume 11"): hood, tunic, arms, legs, skirt and cloak items, `REF11_LOADOUT`, `REF11_TINT`; hooded (the face in shadow, no lit twin) |
| `moon.js`, `swallow.js`, `warden.js` | the three outfit options' items, loadouts (`MOON_LOADOUT`, ...) and colours (`MOON_TINT`, ...): the Moonlit Robe, the Swallow, the Moon Warden |
| `../heroGeo.js` | the geometry builders every item is made of |
| `../heroDims.js` | `DIM`, `BODY`, `REST`, `HAIR_CLUSTERS` (the body's measurements) |

### Outfit options (kept for later; today's look is the default)

An outfit option is a loadout plus its colours: a `tint` (`{ <HERO_INK name>: { fill?, ink?,
emissive?, spec?, rim?, sub?, inkGlow?, glowK? } }`) that `tintHero(rig.materials, tint)` (`model.js`)
writes on ONE rig's material instances. A tint never names `skin`, `eye`, `blade`, `bladeTip`, `gem`
or `flask`, and never touches the shared `U.*` (the per-part ink every rig on the page reads; the
bosses build from `HERO_INK` too). To add one: a file here with its items (`<set>.<piece>` ids, built
from `heroGeo.js`, `sheet.js` and `hands.js`), registered in `index.js`'s loop; a `HERO_LOOKS` entry
in `looks.js`. A look whose bare head may read as a "gold face" at the game camera also gets a
shaded twin: a second head item with `shadowsFace: true` (same `build`), a `<id>-shade` entry with
`of: '<id>'`. `?heroLook=<id>` wears it, the Lab's OUTFIT row switches it live. Once the owner picks
one, `looks.js`, the switch and the losing options go and the pick becomes `DEFAULT_LOADOUT` (its
tint applied beside it).

## Slots

Built in this order. The body is never bare: a loadout that leaves `chest`, `arms` or `legs` empty
gets the `base.*` item for it. Any other slot may be empty.

| Slot | Covers | Hangs on | Default item |
| --- | --- | --- | --- |
| `head` | helmets, hoods, masks. Hair, face and neck are the body, not gear; an item with `hair: [...]` keeps only those pieces of the hair (`'cap'` and `HAIR_CLUSTERS` names), `hidesHair: true` none of it; `shadowsFace: true` puts the face and neck in the item's shadow (near-black, no eyes) | `head` | `shroud.hood` (keeps the cap, builds its own gold strands, shadows the face) |
| `chest` | the torso from the hips' top (1.09 m) to the collar: shell, shirt, buttons, belts, baldric, lapels, collar, yoke, emblem | `spine`, `chest` | `shroud.tunic` |
| `shoulders` | shoulder armour: the pauldron on its own joint, and any lames riding on the upper arms | `pauldron`, `arms.R.upper`, `arms.L.upper` | none (`wanderer.pauldron` in the Wanderer's set) |
| `arms` | both arms from the shoulder joint to the hand: sleeves, deltoid caps, vambrace / bracer, gauntlet / glove (the hands), elbow and wrist points. The SWORD hand's fist (`gripFist`) hangs on the `sword` joint, the grip's own frame, so it closes round the grip in every pose; it belongs to this slot, not to `weapon` | `arms.{R,L}.{upper,fore}`, `arms.L.wrist` (the free hand), `sword` (the fist) | `shroud.arms` |
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
| `streamers` | any (a weapon's own: `weapon`) | array of `{ segs: [root, tip], len: [l0, l1], out, lag?, max?, w?, arm?, wrap?, inMax?, floor?, breeze?, weapon? }` (below) |
| `offHand` | `arms` | `{ open, grip, fingers? }`: the free hand open, the same hand closed round the grip `DIM.offGrip` below the sword hand (on the `sword` joint), and (optional) the sword fingers (`swordFingers`). Hang `open` and `fingers` on `arms.L.wrist` in wrist space (the hero's animator turns that joint) and put all three in `keep`; the animator shows one of them (`twoHand` and the hand's distance from the grip, the pose's `hs`). Build it with `buildFreeHand(ctx)` (`hands.js`): it does all of that |
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
  `flap`, and its own idle stir `breeze` / `idleFlare` (else the tables'); `len` is the pair of
  spring lengths, `r0` the anchor's distance from the pelvis axis; each strip is
  `{ joint, len, rest, phase }`. The idle breeze has per-panel values for the first six panels
  (`BREEZE` / `IDLE_FLARE`); later ones get none unless they set their own. `COAT_PANELS` in
  `wanderer.js` is the worked example; `panelSkirt` (`sheet.js`) builds a skirt from such a table
  (plus `hemFrom`: 0..1 down the lower sheet where the pale `hem` takes over; `fadeFrom` with the option
  `fade`: a step between the coat and the hem along torn lines; `mat`: the panel in another HERO_INK cloth).
- **Streamers** (`streamers`). Two-segment springs: `segs[0]` at the root, `segs[1]` at
  `−len[0]` below it; `out` is the resting outward flare; `lag` (default 1) scales how far the
  sheet trails the motion: 1 is a light ribbon that streams out level at a run, the cloak uses 0.5;
  `max` (default 2.6 rad) is how far a segment may swing from hanging, the cloak uses 1.45;
  `inMax` ([root, tip] rad, + = toward the wearer) caps how far each segment may swing IN (a head
  ribbon or a scarf off the back that must not swing into him; negative = always at least that far
  out; not applied while he lies down); `wrap` is the radius the sheet curves round at its root
  (the tests model the sheet with it); `floor: true` keeps its ends over the grass while he rolls or
  falls (a head ribbon: the forward roll puts his crown at the grass; a lagging end is eased back
  out, never snapped); `breeze` ([extra out, rate]) swells the flare slowly by up to that much while
  the wearer is near still (fading out by 4 m/s), so a cape never hangs dead (Halcyon's, `?halCape=3`).
  Any slot may return streamers.
  `weapon: true` marks a weapon's own streamer (the moon ribbon off the pommel): the tests count
  the cloak's sheets without it.
  The root may hang on any joint (the cloak drapes one sheet over each upper arm). Give `w` (the
  widths [root, seam, hem]) so the animator can keep the sheet off the blade (ADR-048: spheres along
  the steel), and `arm` (1 / 2 for a sheet on the right / left upper arm). The arms do not push the
  cloth: a cloak hangs over its wearer's arms (holding the sheets out round them made the figure
  wide from behind).
- **The arms.** `_arm` compresses the last of each arm's reach (ADR-044), so a hand target at
  full stretch is reached with the elbow still bent (~35° for a duelist; the hero's arms open
  further, ~20-30°, ADR-090): model sleeves and hands for a bent arm, and do not rely on a pose
  locking the elbow. The heavy blows, the charge and the block are two-handed
  (ADR-071): the free hand spends time on the grip, so return `offHand` if the item draws hands.
  The free hand turns on its wrist (`arms.L.wrist`: sword fingers, a point, a palm braced on the
  grass): hang the open hand and the sword fingers there, keep the forearm's own meshes on
  `arms.L.fore` (a flask or a bracer stays on the forearm), and keep the left wrist clear of a
  drape so the pale hand reads on its own.
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
