# Obsidian Drake: visual and anatomy build spec

Source: the owner's concept sheet **"OBSIDIAN DRAKE"** (`images/3.webp`). It has three panels:
the full painting (three-quarter front view, a 1.8 m hero standing at the near front foot for
scale), a **head study** (left profile, mouth open) and an **"ASCII GAMEPLAY"** render (a crouched
fire-breathing pose with the wings fully spread). The owner's verdict on v0.3 was that the in-game
dragon "doesn't look like the images", and the owner chose to **rebuild it as a four-legged dragon
with separate wings**. Today's model is a wyvern whose wings double as front legs.

This document is the target. It is written for whoever rebuilds `src/entities/dragon/model.js`,
`membrane.js`, `tuning.js` (`ANATOMY`), `rig/*` and the attack poses in `attacks.js`. Each number
says which frame and unit it uses.

## 0. Conventions and gap analysis

**Units.** "Painting m" are metres measured off the painting with the hero as 1.8 m. "Model" units
are what `model.js` and `ANATOMY` are authored in. The root is scaled by `SCALE` = 1.875, so
1 model unit = 1.875 world m, and the 1.8 m hero is 0.96 model units tall.

**Reference height H** is the withers height: the top of the shoulders, measured without spikes.
Every proportion below is a ratio to H, so the build can be resized with one number.

**Frames.** These match the current code. The root is the ground point under the torso centre,
with +Z forward and +X model-left (side sign `s = +1`). Joints point +Z down the bone.
`horn(len, r, x, y, z, pitch, yaw, curve)` follows `model.js`: pitch is positive downward,
yaw = π points backward, and Euler order is YXZ. `spike(len, r, x, y, z, tilt, roll, curve)` stands
up from a surface, and `tilt` leans it back toward −Z.

**Fit factor.** The painting dragon is about 9 m at the withers and 38 m from nose to tail. That
is about 20 % bigger than the gameplay envelope tuned at `SCALE` 1.875, which is ~30–34 m nose to
tail with the hero's sword band reaching ~3.8 m up. The ASCII panel draws the dragon about half as
big relative to its hero. The recommended **build** keeps `SCALE` = 1.875 and authors
**H = 4.0 model (7.5 m world)**, a fit of k ≈ 0.83 of the painting. That keeps the painting's
proportions exactly, keeps nose-to-tail at ~34 m straightened (today: ~33.5 m), keeps the chest
keel at 2.6 m (inside the sword band) and keeps every AI range valid. To get painting-true size,
set H = 4.8 model and re-tune the ranges.

### What is wrong with v0.3 today (ranked by how far it is from the art)

| # | v0.3 today | Concept art |
|---|---|---|
| 1 | Wyvern: two hind legs, and the wings walk on their wrists | **Quadruped**: four legs with big clawed feet, plus a separate pair of wings rising from the top of the back |
| 2 | Long, low torso (withers ~3.3 model); the chest hangs ~1.1 model off the ground | Tall, **deep barrel chest** (withers 4.0, keel 1.4) on columnar forelegs; the back slopes down to a lower rump |
| 3 | Long neck (7 × 0.68 = 4.76 model) | **Short, very thick S-neck** (visible run ~2.3 model). The head sits barely above and ahead of the chest |
| 4 | 3 fingers, wings usually folded into "legs" | **4 fingers** fanned from a **high wrist** (≈1.8 H). Wings are held **half-raised like tall sails** (signature silhouette), with a ragged scalloped trailing edge and a big hooked thumb claw |
| 5 | Body glyphs are `.vVV` chevrons only, in dim silver | Dense **mixed blocky glyphs** (`A 8 0 O B D S V`), bright white on the lit tops, grey on the flanks, near-black gaps |
| 6 | Horns 2.4 model (1.65 × head), one pair dominant, mace-like tail tip | Main horns ≈ **1.1 × head length**, sabre-curved upward, plus secondary horns, cheek horns, crown spikes, jaw spikes and a nape ruff. The **tail tapers to a point** (no mace) |
| 7 | Membrane glyphs are vein strokes `.:\|!` | Membrane is a grid of **round red glyphs** (`o e C S O 0 6 8`); bones are **single bright white glyph lines** |
| 8 | Lava fairly uniform on chest, belly, throat, thighs and tail | Lava strongest on the **throat-to-sternum S** and the **chest keel**, medium on the belly and inner legs, then thin cracks. The whole **dorsal spike row reads orange** in the ASCII panel |

## 1. Overall anatomy and proportions

### 1.1 Measurements

All measurements are pixels on the 1536 × 1024 sheet. The hero is 90 px tall
(y 842 → 932 at x 915–945) and stands at the depth of the near front foot. H = 450 px.
Ground y varies with depth: near front foot 930, far front 905, near hind 895, far hind 870.

| Measure | × H | Painting m | Model (painting ÷ 1.875) | **Build model (H = 4.0)** | Build world m |
|---|---|---|---|---|---|
| Hero height | 0.20 | 1.8 | 0.96 | (0.96) | 1.8 |
| **Withers** (top of shoulders, no spikes) | 1.00 | 9.0 | 4.8 | **4.0** | 7.5 |
| Dorsal spikes above the withers | +0.12 | +1.1 | +0.6 | +0.5 | +0.9 |
| Rump top | 0.70 | 6.3 | 3.36 | 2.8 | 5.25 |
| Hind hip joint | 0.58 | 5.2 | 2.8 | 2.3 | 4.3 |
| Front shoulder joint | 0.69 | 6.2 | 3.3 | 2.75 | 5.2 |
| Chest keel (lowest point of the sternum) | 0.35–0.38 | 3.3 | 1.75 | **1.4** | 2.6 |
| Belly under the loins | 0.43 | 3.9 | 2.1 | 1.75 | 3.3 |
| Chest depth (withers → keel) | 0.62 | 5.6 | 3.0 | 2.6 | 4.9 |
| Chest width (ribcage, without shoulders) | 0.50 | 4.5 | 2.4 | 2.1 | 3.9 |
| Width over the shoulder masses | 0.60 | 5.4 | 2.9 | 2.4 | 4.5 |
| Torso length (sternum front → tail root) | 1.33 | 12.0 | 6.4 | **5.3** | 9.9 |
| Front ↔ hind foot contacts (z spacing) | 0.90 | 8.1 | 4.3 | 3.6 | 6.75 |
| Eye height, standing tall (painting pose) | 1.22 | 11.0 | 5.9 | **4.9** | 9.2 |
| Horn tips, standing tall | 1.51 | 13.6 | 7.25 | 6.0 | 11.3 |
| Head length (snout tip → occiput, no horns) | 0.28 | 2.5 | 1.34 | **1.3** (1.12 true; +15 % for top-down legibility) | 2.4 |
| Main horn length | 0.31 | 2.8 | 1.5 | 1.5 | 2.8 |
| Neck, centreline base → occiput | 0.58 | 5.2 | 2.8 | 2.3 visible, **3.2 chain** (coiled S, see 2.2) | 6.0 |
| Neck diameter at base / under head | 0.27 / 0.19 | 2.4 / 1.7 | — | 1.24 / 0.8 | — |
| **Tail** (root → tip along the curve) | 2.1 | 19 | 10.1 | **8.3** | 15.6 |
| Tail diameter at root | 0.24 | 2.2 | — | 1.1 | 2.1 |
| Front leg: humerus / forearm / hand | 0.26 / 0.34 / 0.11 | | | 1.05 / 1.37 / 0.45 | |
| Front claws | 0.11 | 1.0 | | 0.45–0.5 | 0.9 |
| Hind leg: thigh / shin / metatarsus | 0.31 / 0.33 / 0.2 | | | 1.25 / 1.3 / 0.78 | |
| Hock height | 0.19 | 1.7 | | 0.75 | 1.4 |
| **Wing arm** (wing root → wrist) | 0.88 | 7.9 | 4.2 | 3.55 (humerus 1.5 + forearm 2.05) | 6.7 |
| Wrist height, half-raised (painting) | 1.85 | 16.7 | 8.9 | **7.2** | 13.5 |
| Thumb hook at the wrist | 0.22 | 2.0 | | 0.9 | 1.7 |
| Fingers f0 / f1 / f2 / f3 | 1.35 / 1.5 / 1.2 / 0.85 | | | **5.4 / 6.0 / 4.8 / 3.4** | |
| **Wingspan**, fully spread | 4.5 | 40 | 21.6 | **18.2** | 34 |
| Nose → tail tip, straightened | 4.3 | 38.6 | 20.6 | 18.1 | 34 |
| Footprint as posed (neck S, tail hooked) | — | — | — | ~13.5 long × 6 wide | 25 × 11 |

The dragon reads as 5 hero heights at the withers, 6 at the eyes and 7.5 at the horn tips. The
wings peak at 10 hero heights. The wingspan is about 1.1 × the straightened nose-to-tail length.

### 1.2 Skeleton layout, standing tall (root frame, build model units)

```
joint                       position (x, y, z)            notes
hips  (pelvis body joint)   (0,     2.40, -1.45)
chest (ribcage body joint)  (0,     2.85, +1.25)          hips frame [0, 0.45, 2.70]
withers surface             (0,     4.05, +1.10)          top of the chest ellipsoid
neck base                   (0,     3.30, +1.70)          chest frame [0, 0.45, 0.45]
occiput (head joint)        (0,     4.85, +3.05)          rest pose
eye                         (+-0.27,4.93, +3.60)
snout tip                   (0,     4.70, +4.30)          head pitched ~7 deg nose-down
wing root                   (+-0.70,3.85, +1.00)          ON TOP of the back, behind the neck base
front shoulder joint        (+-1.00,2.75, +1.85)          chest frame [+-1.0, -0.10, 0.60]
front elbow                 (+-1.12,1.80, +1.45)          points BACK
front wrist                 (+-1.18,0.50, +1.90)
front toe contact           (+-1.25,0,    +2.15)
hind hip joint              (+-1.00,2.30, -1.35)          hips frame [+-1.0, -0.10, 0.10]
knee                        (+-1.10,1.45, -0.45)          points FORWARD
hock                        (+-1.15,0.75, -1.50)          points back, 0.19 H off the ground
hind toe contact            (+-1.25,0,    -1.45)
tail root                   (0,     2.55, -2.55)          hips frame [0, 0.15, -1.10]
```

Side profile (not to scale; it shows the stacking):

```
 y  7 |              ,,v'  <- wrist + thumb hook (7.2)
    6 |    f0 ______/ |         horns ~6.0  __/\
    5 |  sail  \  \   |arm         /\_____/ o  \___  eye 4.9 / snout 4.7
    4 |  ~~~~~~^^^^^^^|^^^^ withers 4.0  (  neck S
    3 |rump 2.8   ___/               \___(  chest   )
    2 |   ( thigh )  | waist |      ( humerus )    )  keel 1.4
    1 |    knee> \   |       |        elbow< \   ./
    0 +---hock /_feet z -1.45----------- wrist \_feet z +2.15 ---> +z
```

Top-down footprint (what the 58° camera mostly sees):

```
              horns V   <- head, arrowhead with a crown (z +3..+4.3)
               \___/
          paw  (neck)  paw      front feet at x +-1.25, z +2.15 (outside the chest)
            \  /###\  /
     wing  =| (chest) |=  wing  wing roots at x +-0.7, z +1.0; wrists high above
             \ waist /
          paw (rump ) paw       hind feet at x +-1.25, z -1.45
               \ |
                ) tail  hooks to model-right and forward
```

## 2. Part by part

### 2.1 Head (head length HL = 1.3 model)

**Skull shape.** A long wedge with a flat-topped snout, a heavy brow shelf and a broad occiput
where the horns root. Seen from above it is an arrowhead about 0.85 model wide at the cheeks and
0.3 at the snout. Build the cranium and snout as `limbGeometry({ length: 1.3, r0: 0.44, r1: 0.15,
sx: 1.0, sy: 0.7, bulge: 0.03 })` at z −0.12 in the head frame. Add brow shelves as ellipsoids
(0.16, 0.10, 0.42) at (±0.25, 0.25, 0.45), yawed ±0.2. The shelves should overhang the eyes by
~0.06.

**Jaw.** The hinge is at (0, −0.15, 0.05) in the head frame. The lower jaw is 0.9 HL long
(`limb length 1.15, r0 0.30, r1 0.11, sx 0.92, sy 0.42`). The painting and head study both show
it **open 25–30° at rest** (mouth glowing). It opens 40° for roar, bite and breath, so `jaw` = 1
should map to 0.7 rad.

**Teeth.** All teeth are ivory, needle-like, irregular (±25 % length) and hooked slightly back.
- Upper, 9 per side, front to back: fang 0.16, then 0.10, 0.08, 0.09, 0.07, 0.08, 0.06, 0.07,
  0.06 model. Radius 0.035; the fang is 0.05.
- Lower, 8 per side, pointing up: fang 0.13, then 0.09 down to 0.05.
- The teeth line the jaw edges from z 0.35 to 1.15. They are clearly visible because the inside
  of the mouth is lit.

**Horns.** There are four horn pairs plus single spikes, all silver-edged obsidian.

| Horn | Count | Length | Base r | Root (head frame) | Aim | Curve |
|---|---|---|---|---|---|---|
| Main horns | 2 | 1.5 (1.15 HL) | 0.15 | (±0.20, 0.30, −0.02) | pitch −0.45 (26° above the skull line), yaw π ∓ 0.22 (13° splay) | 0.35: straight for 70 %, tip sabres **up** ~20° |
| Secondary horns | 2 | 0.85 | 0.10 | (±0.30, 0.12, 0.0) | pitch −0.10, yaw π ∓ 0.45 | 0.15 |
| Cheek (jugal) horns | 2 | 0.65 | 0.09 | (±0.38, −0.02, 0.30), behind and below the eye | pitch +0.08, yaw π ∓ 0.50 | 0, straight back. Very prominent in the head study |
| Crown spikes (midline) | 5 | 0.10, 0.16, 0.24, 0.33, 0.42 (snout → occiput) | 0.04–0.09 | z 0.95, 0.75, 0.55, 0.35, 0.12 on the skull top | `spike` tilt 0.9–1.0 (lean back 50–57°) | 0.1 |
| Nose horn | 1 | 0.18 | 0.06 | (0, 0.14, 1.18) | `spike` tilt 0.5, leaning back | 0.1 |
| Nape ruff | 4 per side | 0.55, 0.48, 0.41, 0.34 | 0.07 | (±(0.22 + 0.07k), 0.05 − 0.10k, −0.10) | pitch −0.15 + 0.25k, yaw π ∓ (0.35 + 0.22k) | 0.12 |
| Jaw-line spikes | 4 per side | 0.16, 0.23, 0.30, 0.37 (front → hinge) | 0.05 | along the lower jaw edge, z 0.75 → 0.15 | down and back (pitch +0.9, yaw π ∓ 0.25) | 0 |
| Chin spike | 1 | 0.20 | 0.05 | jaw tip (0, −0.15, 1.05) | pitch +1.3 (down) | 0 |

From above, the main horns make a **V opening backward** of about 26°. From the side they rise
above the neck line and reach back to the nape spikes.

**Eyes.** Each eye is a small almond, 0.07 HL long: ellipsoid (0.09, 0.06, 0.13) at
(±0.27, 0.15, 0.55), with the outer corner rotated **20° up**. The eye sits under the brow shelf
and glows amber-orange with a hot core, the brightest point on the head after the mouth. It is
closed (dark) when asleep.

**Head scales.** Small, sharp scales on the snout (0.08–0.10 model) and larger plates on the
cranium (0.15). The brow and cheek plates have raised silver edges.

### 2.2 Neck

**Shape.** The neck is short, massive and S-curved. It rises **steeply** (70–85°) from the top
front of the chest, its nape bulges back over the withers toward the wing roots, and it then
curls forward so the head is held level, **only ~1.2 model ahead of the sternum front** and
about 0.9 above the withers. The throat bulges forward as a continuous S into the chest.

**Length.** The painting-true centreline is 2.3 model (build). Build it as a **chain of
7 × 0.46 = 3.2** and coil the extra length into the rest S. That way it reads short at rest but
can stretch for the bite (see §5).

Rest-shape target: the chain must pass through (0, 4.3, 1.55), which is the nape over the
withers, and end at the occiput (0, 4.85, 3.05). Starting `buildRest` parameters are `pitch0`
1.70, `pitchStep` −0.30, `pitchCurve` 0. Tune them in the Lab until those two points are hit.

**Thickness.** Radius 0.62 at the base tapering to 0.40 under the head, with an elliptical cross
section (sy 0.92). It is as thick as the head is wide.

**Spikes and frill.**
- Dorsal crest, one per segment, in the orange `spine` material: 0.55 at the nape, tapering to
  0.40 behind the head, leaning back 50°.
- Two lateral rows of **shingle plates** per segment. These are flattened `hornGeometry` cones,
  length 0.32, r 0.09, laid almost flat (leaning back 75°) at ±55° around the neck. Each side row
  is offset half a segment. These blade-like neck plates are the head study's most striking
  texture: they make a serrated ruff silhouette instead of a smooth tube.

**Throat.** A lava strip runs under the neck from the jaw to the chest. It is the brightest body
lava after the mouth and chest (§2.9).

### 2.3 Torso

All positions below are root-frame centres; radii are (x, y, z).

| Mesh | Centre | Radii | Material |
|---|---|---|---|
| Ribcage | (0, 2.85, 1.25) | (1.05, 1.25, 1.50) | scales |
| Molten sternum plate (bulges front and bottom; its lowest point is the 1.4 keel) | (0, 2.25, 1.90) | (0.85, 0.85, 1.05) | belly lava |
| Shoulder masses (scapulae) | (±0.95, 3.00, 1.55) | (0.50, 0.85, 0.75) | scales |
| Waist | (0, 2.55, −0.20) | (0.95, 0.80, 1.45) | scales |
| Belly lava strip | (0, 2.05, −0.10) | (0.80, 0.45, 1.40) | belly lava, fading toward the hips |
| Rump / pelvis | (0, 2.35, −1.65) | (0.95, 0.62, 1.05) | scales |
| Thigh masses | (±1.00, 2.05, −1.25) | (0.55, 0.90, 0.95) | scales, lava on the inner side |

**Back line.** Withers 4.1 at z 1.1, then mid-back 3.35, rump 2.97 and tail root 2.55. That is a
**~16° slope** down toward the tail. Do not make the back level.

**Dorsal spikes.** One continuous midline row from the nape to the tail tip, all in the orange
`spine` material.
- Over the withers and between the wing roots, the spikes are 0.6–0.75 long and lean back 50°.
- Mid-back spikes are 0.5, rump spikes 0.45.
- Spacing is 0.42 along the back.
- Two small flank rows (0.3, rolled ±1.1) run over the shoulders and rump only.
- The shoulder masses each carry a cluster of 3 silver shard spikes (0.35) pointing back and up.
  This is the jagged "shoulder pauldron" in the painting.

### 2.4 Front legs (separate from the wings)

**Joints.** The shoulder joint sits low on the side of the chest at (±1.0, 2.75, 1.85).
- Humerus 1.05, running down and back.
- **Elbow points back.**
- Forearm 1.37, running down and slightly forward.
- Wrist 0.5 off the ground.
- Hand 0.45, nearly vertical: a **semi-digitigrade** stance with toes flat and splayed and the
  heel off the ground.

Seen from the side the leg is a near-column, slightly bowed (elbow angle ~135°). Two-bone IK runs
shoulder → wrist with the **pole backward**, the reverse of the hind knee. The wrist target is
the toe contact + (0, 0.5, −0.25).

**Bulk.**
- Upper arm: `limb r0 0.48 → r1 0.33, bulge 0.1`. Elbow knob: ellipsoid (0.30, 0.30, 0.32).
- Forearm: `r0 0.36 → r1 0.26`.
- Hand: `r 0.24 → 0.20`.
- Paw pad: ellipsoid (0.40, 0.18, 0.42).

Forelegs are thinner than the hind thighs but thicker than the wing arm.

**Spikes.**
- Back of the elbow: a cluster of **3 big blade spikes**, 0.60, 0.45 and 0.30, pointing back and
  up about 40° above horizontal. In both the painting and the ASCII panel these are the foreleg's
  identity.
- Back edge of the forearm: a row of 4 small spikes, 0.25 → 0.12.

**Claws.** Four forward claws per front foot:
- Lengths 0.42, 0.50, 0.50, 0.42 (outer → inner), base r 0.09, `curve` −0.30 so they hook down.
- Each angles 0.35 down at the root. Yaw splay is −0.5, −0.17, +0.17, +0.5 rad.
- An inner dewclaw (0.28) sits at wrist height, pointing back and down.
- The claws are ivory/bone white with dark bases and are the brightest things on the legs.

**Lava.** Thin cracks on the front of the forearm and at the wrist. A posterior strip runs down
the back of the forearm; it is the orange back-edge rim seen in the ASCII panel. The armpit
(where the humerus meets the chest) gets a lava patch.

### 2.5 Hind legs

**Joints.** The hip joint is at (±1.0, 2.3, −1.35). The leg makes a crouched Z:
- Thigh 1.25, running forward and down 45°. The **knee points forward** and low.
- Shin 1.3, running back and down. The hock sits **0.75 off the ground**, behind the toe contact.
- Metatarsus 0.78, nearly vertical, tipped slightly forward. This is **digitigrade**.

The foot lands slightly behind the hip joint, under the rump.

**Bulk.** The thighs are **massive**: `limb r0 0.72 → r1 0.42, bulge 0.15`, plus the thigh mass
ellipsoid from §2.3. Shin `r0 0.42 → 0.26`, metatarsus `0.26 → 0.20`, foot pad ellipsoid
(0.42, 0.18, 0.50).

**Spikes.**
- A row of 5 blade spikes (0.50 → 0.25) along the back and top contour of each thigh, leaning
  back. These continue the rump's spikes.
- Two spikes (0.35, 0.25) point back off the hock.

**Claws.** Three forward claws (0.50, 0.58, 0.50, r 0.10, curve −0.3, yaw −0.45, 0, +0.45), one
inner claw (0.40) and a heel spur (0.35) pointing back. All are ivory.

**Lava.** The inner thigh is medium (the existing inner-thigh strip works). Thin cracks run at the
knee, the hock and between the toes.

### 2.6 Wings (separate limbs on the back)

**Attachment.** The wing root sits **on top of the back**, at (±0.70, 3.85, 1.00): above the
front shoulder joints, just behind the neck base and between the shoulder spike clusters. The
painting's wing arm grows out of the withers. It is not a front leg.

**Arm.**
- Humerus 1.5: scaled hide (scales material), `r0 0.32 → 0.22`. A row of 5 spikes (0.25) runs
  along its trailing edge.
- Forearm 2.05: `r 0.20 → 0.14`, in white bone strokes (wingBone material). In the painting the
  arm reads as one long, slightly curved column. Keep the elbow angle above 140° in the
  half-raised pose so it does too.

**Wrist.** A knob (ellipsoid 0.24, 0.22, 0.28) with:
- **Thumb hook**: `hornGeometry(0.9, 0.14, { curve: −0.35 })` in ivory. It is a sickle that
  points forward and down when folded, and straight down when raised. It is the highest bright
  accent of the silhouette.
- **Wrist spikes**: two, 0.45 pointing up-back and 0.30 pointing out, in the orange `spine`
  material. The ASCII panel marks each wrist with an orange `A`.

**Fingers.** There are **four**: f0 is the leading edge, f1–f3 trail behind it. The painting's
near wing and the ASCII near wing both show 4 bones fanning from the wrist.

| Finger | Length | Knuckle at | Distal kink (rest → spread) | Tip |
|---|---|---|---|---|
| f0 leading edge | 5.4 | 62 % | −12° down → −4° | straight spike 0.4 |
| f1 | 6.0 | 58 % | **−30° down** (the painting's drooping outer finger) → −9° | hooked claw 0.28 |
| f2 | 4.8 | 60 % | −10° → −3° | hooked claw 0.28 |
| f3 (inner) | 3.4 | 65 % | 0° | hooked claw 0.25 |

- Finger bones: `limb r0 0.11 → r1 0.045`, white strokes.
- Each knuckle has a bump (ellipsoid 0.09) and a 0.15 spike.
- The leading edge (forearm + f0) carries small serrations: spikes 0.12, every 0.5.

Build each finger as **2 joints** (proximal + distal) so the kink can animate. Spreading the wing
straightens the kinks to 30 % of their rest angle.

*Superseded 2026-11-08 (reference match):* finger lengths are [6.2, 6.9, 5.5, 3.9]. The proximal
bones (wrist → knuckle) keep the lengths above, because the wing hurt spheres sit on the knuckles;
only the distal bones are ~1.35× longer (the painting's huge bat wings).

**Membrane.** Use **4 panels**:

| Panel | Edges | Scallop depth (SAG) |
|---|---|---|
| 1 | f0 – f1 | 0.30 |
| 2 | f1 – f2 | 0.28 |
| 3 | f2 – f3 | 0.24 |
| 4 (inner) | f3 tip → down the flank to a hip attach at (±1.0, 2.9, −1.6), bounded by the forearm and humerus | 0.18 |

- Raise the sample grid to NU 10 × NV 13 so the tears resolve.
- The **trailing edge is torn**: 6–8 sawtooth notches per panel with an extra pull (`RAG`) of
  0–0.26, plus 1–2 small holes per wing (an optional shader mask, §3.3).
- The ASCII panel's trailing edges also **drip**: some glyph columns hang a cell or two lower
  than their neighbours.
- *Built (2026-11-08):* `SAG` [0.30, 0.28, 0.24, 0.16] (fuller sails; fix round 1 had 0.42 / 0.40 /
  0.34 / 0.22), `RAG` rips up to 0.29, and the art source tears holes and a ragged trailing edge from
  `aEdge`.

**Resting pose (the painting).** The wings are half-raised, or mantled.
- The arm rises nearly vertically from the root, tilted 8° forward and 15° outward. The wrist
  sits at **(±1.5, 7.2, 1.0)**.
- The fingers fan **back and down** like a tall sail behind and above the body:

  | Finger | Direction (hips frame, left wing; mirror x for the right) |
  |---|---|
  | f0 | (0.35, −0.25, −0.90) |
  | f1 | (0.25, −0.72, −0.65) |
  | f2 | (0.15, −0.85, −0.50) |
  | f3 | (0.10, −0.95, −0.25) |

  All directions are normalised. f1's tip ends around y 2.2 over the tail root; f3's tip reaches
  the flank above the foreleg.
- The far wing in the painting is the same pose, opened ~25° more to the side.
- Folded and fully spread poses are in §4.
- *Superseded 2026-11-08:* the resting HALF key is a cambered sail fitted to stay broad from every
  game-camera yaw (wrist (±2.1, 7.5, −0.78), the leading finger falling away from the wrist peak),
  and the wings turn with the head toward a foe off to one side, so the far wing reaches past the
  head. See "Implementation notes (reference match)".

### 2.7 Tail

**Length.** 8.3 model (16 × 0.52), about 1.6 × the torso. The radius tapers as
`r(t) = 0.05 + 0.52·(1 − t)^1.15` with an elliptical section (sy 0.9). It is thick where it
leaves the rump and **ends in a point. There is no mace or spike cluster.** Replace the 7-spike
tip with one 0.6 blade plus two 0.2 side blades.

**Pose.** At rest the tail leaves the rump pitched down ~20° and lies on the ground from about
40 % of its length. It sweeps back, then **hooks sideways and forward** in a lateral curl of
~150° total, with the tip ending roughly level with the hind feet. The dorsal blades stay on top
the whole way. The painting curls it toward the viewer, which is model-right. Implement this with
a quadratic yaw term in `Chain.buildRest`: add `yawCurve`, so `yaw_i += yawCurve·i²`, around
0.012. A constant `yawStep` makes a circle, not a hook.

*Superseded 2026-11-08:* at rest the tail is carried about level off the rump for a third of its
length, then arches down to land almost flat on the ground around segment 11, the end hooking
(`REST_POSE.tail`, blended by `pose.tailLift`). The tail sweep and the stomp's tripod lay it low.
The drawn tail is thicker at the root, `r(t) = 0.06 + 0.7·(1 − t)^1.4`, over the unchanged chain
clearance above.

**Spikes.**
- A dorsal row of **broad flat blades** like saw teeth: 0.55 at the root down to 0.12 at the tip,
  leaning back 50°, in the orange `spine` material. In the painting these blades have glowing
  orange edges; in the ASCII panel they are orange `A`/`^` glyphs.
- Two lateral rows of smaller blades (0.30 → 0.08, rolled ±1.3) on the first 13 segments.

**Lava.** The underside glows on the first 70 % (the existing tail lava strip), with sparse cracks
along the sides.

### 2.8 Scales

**Shape.** Scales are lanceolate shards, like leaves or flint flakes, with sharp tips pointing
**toward the tail on the body and down on the neck and legs**. Their tips lift 10–20° off the
skin, so silhouettes are serrated. They overlap like shingles (each row covers ~40 % of the next,
offset half a scale). The centres are charcoal-black with a slight violet-blue sheen, and the
raised edges catch silver-white highlights.

**Size.** Roughly one glyph cell per scale (build model units):

| Region | Scale size |
|---|---|
| Snout | 0.08–0.10 |
| Cranium | 0.15 |
| Neck shingles | 0.25–0.32 (the largest relative to their surface) |
| Chest and ventral plates | 0.30–0.40 wide, banded |
| Back and flanks | 0.20–0.25 |
| Legs | 0.14–0.20 |
| Tail | 0.18, shrinking to 0.08 at the tip |
| Wing arm | 0.14 |

**Colour.** The obsidian reads as **black with a warm cast**, because orange lava light falls on
it. The painting's mid-tone is linear [0.015, 0.009, 0.008]. Highlights are a warm silver,
linear [0.43, 0.35, 0.34], under lava light. In the ASCII panel the highlights are neutral white,
linear [0.51, 0.49, 0.49].

### 2.9 Lava map (where the molten orange is, and how strong)

Strength runs 0 (none) to 1 (max) in the phase-1 idle. Phase 2 multiplies everything (the
existing `GLOW` model).

| Region | Strength | How it looks |
|---|---|---|
| Mouth interior (maw) | **1.0** | Yellow-orange fire visible through the teeth; underlights the teeth and jaw |
| Eyes | 0.9 | Small amber points |
| **Throat** (under the jaw → chest, the whole S) | **0.75**, charging to 1.2 before breath or roar | Bright orange between large ventral plates. Hottest just under the jaw and where the neck enters the chest |
| **Chest keel and lower chest plates** | **0.8** | The brightest body area: a vertical molten seam down the sternum with branching cracks, plates rimmed gold-orange |
| Belly (between the forelegs → waist) | 0.55 → 0.2 at the loins | Gold-orange plate rims fading toward the hips |
| Armpits, inner forelegs | 0.45 | |
| Inner thighs | 0.4 | |
| Tail underside (first 70 %) | 0.35 | |
| Dorsal spike roots, tail-blade edges, wrist spikes | 0.35 (orange ink, self-lit) | The orange "spine line" of the ASCII panel |
| Leg fronts, elbows, knees, hocks, toe joints | 0.15–0.25 | Thin cracks |
| Neck sides (between shingles) | 0.2 | Sparse vertical cracks; denser toward the throat |
| Back and flanks (between scales) | 0.06 | Faint embers; 0.6 in phase 2 |
| Wing membrane | 0.2 overall, 0.35 near the arm and inner panel | Orange crust flecks and embers on dark red |
| Wing bones, horns, claws, teeth | 0 (bones 0.3 in phase 2) | |

Measured from the painting: saturated lava covers ~15 % of the chest region, 4 % of the neck
side, 5 % of the tail and 2 % of the legs. Use those as density targets for `altChance` and
crack glow.

### 2.10 Colours (linear RGB, for glyph inks and bases)

These are sampled from the sheet and converted to linear. "Ink" is albedo, so the shader
multiplies it by light × `gain`.

| Use | Linear RGB | Source / note |
|---|---|---|
| Obsidian gap (base) | **[0.016, 0.012, 0.013]** | Painting mid-tone [0.015, 0.009, 0.008]; slightly warm black |
| Scale ink (silver-white) | **[0.40, 0.40, 0.44]** | Panel highlights [0.51, 0.49, 0.49]; the moon is cool and lava lights add warmth |
| Scale ink alt (ember scales) | [0.85, 0.30, 0.07], ~8 % | Panel scatters orange glyphs over the body |
| Lava ink | **[1.0, 0.42, 0.10]** | Painting hot [0.81, 0.25, 0.06]; panel chest [0.82, 0.34, 0.13] |
| Lava ink alt (white-hot) | [1.0, 0.70, 0.32] | Panel peaks [0.92, 0.75, 0.56] |
| Lava base | [0.16, 0.03, 0.008] | Painting lava mid [0.18, 0.03, 0.01] |
| Membrane base | **[0.10, 0.014, 0.011]** | Painting membrane mid [0.10, 0.015, 0.012] |
| Membrane ink | **[0.45, 0.08, 0.05]** | Panel membrane glyphs [0.36, 0.09, 0.07] (salmon-terracotta) |
| Membrane ink alt (hot flecks) | [1.0, 0.38, 0.08], 12 % | Painting far-wing hot [0.72, 0.20, 0.05] |
| Bone (wing arm, fingers) ink | [0.78, 0.77, 0.80], base [0.045, 0.043, 0.048] | Panel bones are neutral white |
| Horns and head spikes ink | [0.80, 0.80, 0.85], base [0.07, 0.068, 0.075] | |
| Spine (dorsal row) ink | **[0.95, 0.45, 0.12]**, base [0.05, 0.02, 0.012] | Panel spine [0.60, 0.26, 0.10] × glow |
| Claws and teeth ink | [0.90, 0.84, 0.72], base [0.14, 0.12, 0.10] | Painting claws [0.45, 0.37, 0.35] lit; ivory |
| Eye emissive | [3.2, 1.1, 0.15] | |
| Maw ink | [1.0, 0.55, 0.15], `inkGlow` 1.8 | Painting mouth peak [0.98, 0.64, 0.38] |

## 3. The ASCII GAMEPLAY panel, translated into rendering rules

*Since v0.4 the player sees the wyrm as ASCII art of a shaded source, and since 2026-11-08 that
source is `WYRM_ART` (the `wyrm` material option), printed in the wyrm's own pixel font. The
surface-glyph tables in §3.2 and the `GLOW` table below them only shape the `U.uArtSolid` = 0
look-dev render now; the current material rules are in "Implementation notes (reference match)".*

### 3.1 What the panel shows

**Pose and view.** The view is from the front-left, elevated about 30°. The dragon is
**crouched low and breathing fire**: forelegs bent with claws planted, chest near the ground,
neck stretched forward and **down** so the head is almost at ground level, and a smear of fire
glyphs at the mouth. The **wings are fully spread and high**, with the wrists above the body and
three scallops per wing. The tail sweeps out behind in a wide C and curls down to the ground.

**Glyph field.** Every cell inside the silhouette holds a glyph: about 95 % occupancy on the
body and 85 % on the membrane. The glyphs sit upright in a regular grid, ~9 px wide and ~10 px
tall on the sheet. At the panel's scale that is about **0.2 model per cell** on the body and
about 0.19 per row on the membrane, almost exactly today's cell size.

**Body glyphs.** Mixed **blocky alphanumerics**: `A 8 0 O B D S 5 6 9 C V K Y ? &`.
- Bright white on the lit upper surfaces.
- Mid grey on the flanks.
- Dim grey `. : ,` on the shadowed underside.
- **Orange glyphs**: the spine row (a line one or two glyphs wide of `A ^ /`, outlining every
  dorsal spike), the chest and belly patch (`V A 8 0 U`, peach to orange), and the **posterior
  edge of each leg** (an orange rim down one side, white glyphs on the other).

**Wings.**
- Membrane: a grid of **round** glyphs `o e c C S O 0 6 8 Q @` in salmon/terracotta red on
  near-black.
- Bones: **single-glyph-wide white lines** made of `| l ! i : / \`, with knuckles drawn as a
  brighter `A`, `8` or `o`.
- The membrane stops about one cell short of each bone, leaving a dark gap that makes the bone
  line read.
- Trailing edge: three deep scallops per wing, ending in ragged drips (columns of 1–3 glyphs
  hanging below the edge).

**Claws.** Each claw is a short column of 2–3 white glyphs (`/ ( 0 V`) ending in a point (`Y`,
`V`, `|`): four columns per foot, splayed.

**Head and fire.** The head is a cluster of white blocky glyphs. The mouth is a hot yellow-orange
smear that continues as fire particles.

**Outline and background.** There is **no drawn outline**. The silhouette comes from bright
glyphs against black, with brighter glyphs along the top edges. Around and under the dragon is
a **dim dotted grid** (`· . : 8 o` at ~10 % brightness): the ground glyph field in its shadow.

### 3.2 Material rules (`createSurfaceGlyphMaterial` options)

**Shared rules.**
- `outline: 0` on everything.
- `rim` 0.35–0.45 on the body, so the moonlit top edges brighten like the panel.
- Cells are in model units (× 1.875 in the world). A 0.2 cell is ~0.38 m, about 12 px at the
  default camera.
- aGUV +y runs along the body toward the head, and along limbs, horns and spikes toward their
  tip (`flip` as today), so directional glyphs (`A`, `V`, `^`) follow the anatomy.

**Glyph variety.** Today's shader picks **one glyph per light level** (`uGlyphs` is a vec4),
which gives 4 glyphs per material. The panel needs ~16 per region.

- **Fallback (no shader change):** give every part its own 4-glyph ramp. The body as a whole
  then shows 12+ distinct glyphs.
- **Recommended (small extension):** add a `variants` option of 4 levels × 4 per-cell
  variants, mirroring `CARVED_DEFAULTS` (a `vec4[4]` or a 16-wide index row). Pick the variant
  with `fract(h * 13.7)`. This is exactly the STYLE rule "mix 4 variants per level". A space is
  a legal glyph, for empty cells.

Every glyph below is in the world atlas. **Do not use `g` or `f`**: they are not in the atlas,
and `npm test`'s glyph check would fail.

| Material | Parts | Variants (L0 dark → L3 lit) | 4-glyph fallback | cell | base | ink / inkAlt / altChance | gain / lumScale / rim | inkGlow / glowMask / emissive |
|---|---|---|---|---|---|---|---|---|
| `scales` | Back, flanks, legs, tail top, wing humerus | `' .:,'` · `':vco'` · `'AVSD'` · `'8B0A'` | `'.vA8'` | [0.20, 0.24], rowShift 0.5 | [0.016, 0.012, 0.013] | [0.40, 0.40, 0.44] / [0.85, 0.30, 0.07] / 0.08 | 2.4 / 3.4 / 0.40 | 0 / 1 / [1.0, 0.36, 0.06] |
| `neck` | Neck, head | Same, plus `'O'` in L3: `'8B0O'` | `'.vA8'` | [0.17, 0.21] | as scales | as scales, altChance 0.10 | 2.4 / 3.4 / 0.40 | 0 / 1 |
| `belly` | Sternum plate, belly strip | `' .:.'` · `'vcuo'` · `'VAUO'` · `'8A0#'` | `'.vA8'` | [0.26, 0.20], rowShift 0.5 | [0.16, 0.03, 0.008] | [1.0, 0.42, 0.10] / [1.0, 0.70, 0.32] / 0.20 | 1.6 / 3.0 / 0.15 | 0.55 / 1 / [1.0, 0.34, 0.05] |
| `throat` | Neck underside | As belly | `'vVA8'` | [0.16, 0.20] | as belly | as belly | 1.6 / 3.0 / 0.15 | 0.55 / 1 |
| `lava` | Inner thighs, armpits, leg back-edge strips, tail underside | As belly | `'vvVA'` | [0.19, 0.22] | as belly | as belly, altChance 0.15 | 1.6 / 3.0 / 0.15 | 0.5 / 1 |
| `membrane` | 4 panels per wing, DoubleSide | `'  .,'` · `'.:co'` · `'oeCs'` · `'O068'` | `'.cO0'` | [0.22, 0.26], **rowShift 0** (the panel's membrane is a straight grid; variants stop it reading as text) | [0.10, 0.014, 0.011] | [0.45, 0.08, 0.05] / [1.0, 0.38, 0.08] / 0.12 | 2.0 / 3.0 / 0.20 | 0.15 / 0.7 / [1.0, 0.30, 0.05] |
| `wingBone` | Wing forearm, finger bones | `'.:..'` · `':\|!:'` · `'\|!l\|'` · `'\|!A8'` | `'.:\|!'` | [0.11, 0.20] | [0.045, 0.043, 0.048] | [0.78, 0.77, 0.80] | 2.4 / 3.2 / 0.45 | **0.25** (bones must stay legible in shadow) / 0.3 |
| `spine` (**new**) | Dorsal row nape → tail tip, tail blades, wrist spikes | `'.:.\''` · `'^!\|:'` · `'^A^!'` · `'AA^8'` | `'.^AA'` | [0.10, 0.15] | [0.05, 0.02, 0.012] | [0.95, 0.45, 0.12] / [1.0, 0.70, 0.30] / 0.2 | 2.0 / 3.2 / 0.35 | **0.35** / 1 / [1.0, 0.38, 0.06] |
| `bone` | Horns, head spikes, elbow / thigh / hock / shoulder spikes, neck shingles | `'.:..'` · `':\|!\''` · `'\|!A^'` · `'A8\|!'` | `".'\|!"` | [0.10, 0.16] | [0.07, 0.068, 0.075] | [0.80, 0.80, 0.85] / [0.85, 0.30, 0.07] / 0.1 | 2.5 / 3.5 / 0.5 | 0.18 / 0.5 |
| `claw` | Claws, thumb hooks, finger-tip claws | `'.:\|!'` · `'\|!Y\|'` · `'V\|Y!'` · `'YV\|A'` | `'.\|VY'` | [0.09, 0.15] | [0.14, 0.12, 0.10] | [0.90, 0.84, 0.72] | 2.4 / 3.5 / 0.4 | 0.25 / 0 |
| `teeth` | Teeth | As today | `".'\|!"` | [0.06, 0.09] | [0.45, 0.40, 0.34] | [1.0, 0.96, 0.88] | 2.0 / 3.0 / 0.3 | 0.9 / 0.6 |
| `maw` | Mouth roof and floor | As today | `'*%#@'` | [0.08, 0.10] | [0.5, 0.11, 0.015] | [1.0, 0.55, 0.15] | 1.0 / 2.0 / 0 | 1.8 / 1 |
| `eye` | Eyes | As today | `'%@#@'` | [0.10, 0.10] | [0.09, 0.02, 0.005] | [1.0, 0.42, 0.06] | — | emissive [3.2, 1.1, 0.15] |

**`GLOW` baselines** (`[phase-1 ember, × glow, × throat charge]`):

| Material | Values |
|---|---|
| scales | [0.06, 0.62, 0] |
| neck | [0.10, 0.62, 0.35] |
| belly | [0.60, 1.0, 0.30] |
| throat | [0.65, 0.9, 1.2] |
| lava | [0.45, 1.0, 0] |
| membrane | [0.20, 0.8, 0] |
| wingBone | [0, 0.35, 0] |
| spine | [0.30, 0.8, 0] |
| bone | [0.04, 0.5, 0] |
| claw | [0, 0, 0] |
| teeth | [0, 0, 0.5] |
| maw | [0.55, 0.6, 1.3] |

**How bones read as lines.** Give finger bones a radius of 0.10–0.12. At 0.11-model cells that
is about 1.5 cells across: one bright glyph column. Keep the membrane's L3 glyphs darker than the
bone ink so the bone line always wins. For the dark gap beside each bone (panel), either:
- (a) offset the membrane 0.05 behind the bone tube, or
- (b) darken membrane cells within 0.15 of a finger with a per-vertex `aBoneDist` attribute,
  computed once from the rest layout like aGUV.

### 3.3 Optional shader extensions, in priority order

1. **Per-cell glyph variants** (above). This has the biggest visual payoff and is cheap.
2. **Ragged membrane edge.** Add a per-vertex `aEdge` attribute: 0 inside, 1 at the free
   trailing edge, computed in `membrane.js` from the panel `v`. Discard a cell when
   `hash(cell) < smoothstep(0.75, 1.0, aEdge) * 0.6`. That gives per-glyph tears and drips. Add
   1–2 holes per wing with an extra `aHole` distance.
3. **Warm under-rim.** A second rim term weighted by `max(0, −n.y)` in lava orange
   ([1.0, 0.36, 0.06] × 0.25). This puts the panel's orange edge on the undersides of limbs and
   belly without extra meshes.

## 4. Poses for the four-legged rebuild

The wing `spread` value gets three keys instead of two:

| `spread` | Key | Meaning |
|---|---|---|
| 0 | FOLD | Closed against the body |
| 0.5 | HALF | The painting's mantled pose |
| 1 | SPREAD | Roar or flight |

Blend piecewise between the keys.

| Pose | Body | Legs | Neck / head | Wings | Tail |
|---|---|---|---|---|---|
| **Standing tall** (painting; intro end, taunt, phase-2 idle) | Chest lifted (pitch −0.08), withers 4.0, back sloping 16° | Forelegs near-straight and vertical (elbow 150°), hind legs crouched (knee 95°), feet at the homes in §1.2 | Upright S, occiput (0, 4.85, 3.05), head level 7° nose-down, **jaw 0.35 open, glowing** | **HALF**: wrists (±1.5, 7.2, 1.0), fingers back-down as §2.6 | On the ground, hooked to model-right (`yawCurve` 0.012) |
| **Combat idle** (phase 1) | As standing, slightly lower (`lower` 0.15) | Same | Head a bit lower and forward: occiput (0, 4.6, 3.3), jaw 0.2 | spread **0.3**: wrists up over the shoulders (painting peaks) with membranes mostly closed. Keeps the view clear. Use 0.5 in phase 2 | Slow sway (`tailWave` 0.07) |
| **Walk** (≤ 5 m/s) | Withers dip 0.06 while a front foot swings, hips dip 0.07 while a hind foot swings; roll ±0.04 toward the planted side; spine yaw ±0.03 counter-phase | **4-beat lateral-sequence walk**: LH → LF → RH → RF at phases 0, 0.25, 0.5, 0.75; swing 25 % of the cycle, so 3 feet are always down. Step height front 0.35, hind 0.30. Cycle ~2.1 s at 3.0 m/s, ~1.7 s at 4.1 m/s (stride ≈ 3.4–3.7 model) | Head stabilised; the neck counter-moves | spread 0.2 | Lagging wave, amplitude 0.08 rad |
| **Trot / charge** (> 5 m/s) | Pitch bob ±0.06 per bound | Diagonal pairs (today's `GROUPS`, with front feet in place of the wing wrists) up to ~8 m/s; above that a **bound**: hind pair, then front pair, offset 0.1 cycle, stride ~0.42 s | Head low and level, horns forward | spread 0.22 | Streams back, low wave |
| **Wings FOLD** | — | — | — | Humerus back from the root, forearm folded forward: elbow (±1.25, 4.15, −0.45), wrist (±1.35, 4.75, 1.45) just above and ahead of the shoulder. Fingers back along the flank: f0 (0.05, −0.08, −1.0), f1 (0.15, −0.25, −0.96), f2 (0.20, −0.35, −0.92), f3 (0.25, −0.45, −0.85). Membrane drapes over the flanks like a cloak, tips over the tail root. Thumb hook rides above the shoulder pointing forward. **Nothing touches the ground** | — |
| **Wings HALF** | — | — | — | §2.6 | — |
| **Wings SPREAD** (roar) | — | — | — | Arm out and up 25°: wrist target (±3.9, 5.3, 1.2), 3.5 from the root (the IK places the elbow near (±2.05, 4.45, 0.6)). f0 (0.75, 0.25, 0.60), f1 (0.85, −0.05, −0.52), f2 (0.70, −0.25, −0.67), f3 (0.35, −0.35, −0.87). Distal kinks at 30 %; membrane taut (SAG × 0.7). Span ≈ 18 (f1 tips at x ±9.0) | — |
| **Breathing fire** (ASCII panel) | Crouch: `lower` 0.6 at the front, so the chest drops toward the ground, while the hips stay higher. Chest swells (y-scale +6 %) through the windup | Forelegs bent and braced wide (front feet step out ±0.2), claws planted | Neck stretched **forward and down**; mouth ~1.6–2.0 model off the ground, ~4.5 ahead of the root. Jaw 0.95 | **SPREAD, wrists high** (panel silhouette) | Wide C behind, curling down |
| **Flying / leap** | Pitch −0.1 climbing, +0.25 diving | Forelegs fold under the chest (paws back); hind legs trail back extended; both extend down and forward for landing | Neck forward, head toward the target | Flap: downstroke 55 % / upstroke 45 %, ±50° at the shoulder. Fingers fold 30 % on the upstroke. Glide at the apex (spread 1, flap 0.5) | Streams straight back as a rudder |
| **Sleeping curled** | On the belly: keel on the ground, hips 0.9 lower than standing. Breath period 4.6 s, ember glow pulsing 0.05–0.15 | Forelegs folded under the chest (sphinx); hind legs folded with knees out, feet under the haunches | Neck curled back along the **right** flank, head resting on the ground beside the right hind foot. Eyes closed (glow 0), jaw closed | FOLD, flattened onto the back (`FOLD_LYING`) | Curled around the left side; the tip ends at the snout, closing the ring |
| **Stagger / posture break** | Front collapses: chest drops onto the forelegs (`lower` 1.0 at the front), hips stay up | Forelegs buckle (elbows out), hind legs brace | Neck limp and low, head on or near the ground | Droop half-open to the ground (spread 0.35, arm lowered, tips touching the ground) | Limp |
| **Death** | Rolls onto the right side (roll 1.2) | Legs stiffen out | Neck sprawled | One wing splays up and over, the other is pinned under | Limp, straight |

*Superseded 2026-11-08:* the combat idle is the painting's display (HALF sails, the head low and
forward on a strong S, jaw 0.65 open, a stalking stance, the arched tail), and death is a timed
collapse in which every foot stays planted and both wings crumple onto the ground. See
"Implementation notes (reference match)".

## 5. Moveset mapping

Every **tell type, windup, active, impact and recovery time** stays exactly as in `tuning.js`
and `docs/COMBAT.md`. Only who does the work changes. Reaches and AI ranges must be
**re-measured in the integration sims**, as `ARCHITECTURE.md` already requires for size changes.

| Ability (tell; P1 windup / active / recovery) | Four-legged performance | Wings | Hit volumes and constants |
|---|---|---|---|
| **bite** (BLUE; 0.75 / 0.2 / 0.8) | **Windup:** forelegs plant a little wider; shoulders sink (`lower` 0.15 → 0.35, pitch +0.1 nose-down); neck coils back into a tight S with the head at (0, 5.3, 2.9) (reachable, 2.3 from the neck base); jaw 0.3, throat glows faintly. **Active:** the neck uncoils and the **shoulders drive forward**: hind feet stay planted as the push, forelegs take one fast half-step, root moves forward 3.0 S m/s (as today), chest pitch 0.14. Jaw snaps shut at k 0.62. **Recovery:** head lifts, the body rocks back onto the hind legs, forelegs re-plant | Brief threat flare to 0.4 during the windup, back to idle on the snap | Snout r 1.05 S, head 0.75 S (unchanged). The 3.2 chain plus lunge must still reach 5.4 S from the neck base. If the sims fall short, raise `neckLen` to 0.5 before touching `reach` |
| **swipe** (NORMAL; 0.8 / 0.25 / 0.7) | Now a **foreleg rake**. **Windup:** weight shifts onto the other three legs (body rolls 0.1 away, chest twists 0.15 toward the swing); the swing foreleg lifts and cocks high and out (paw at root (±2.3, 3.3, 2.0)), elbow out, claws spread. **Active:** the paw sweeps along a Bezier P0 (±2.3, 3.3, 2.0) → P1 (±3.3, 1.1, 3.9) → P2 (∓0.4, 0.3, 4.6). Its arc ends crossing the midline with the claws raking the ground (dust). Chest twist 0.35, yaw +0.6 over the phase (as today), and a **0.5 forward root lunge** so the 2.87 leg reaches P1. **Recovery:** the paw plants at P2 as the new contact, then steps home | The swing-side wing flares to 0.45 for balance and as the silhouette tell. It never strikes | Replace `pt.wings[..]` spheres with `pt.arms[..]`: paw r 1.1 S, claw tips r 0.8 S, forearm mid r 0.75 S. P0/P1/P2 replace `SWIPE_P*`. Re-measure the 4–5.8 S band |
| **clawCombo** (N, N, BLUE; 0.8 / 0.55 / 0.6 windups, 0.25 / 0.25 / 0.24 actives, recovery 1.0) | Hit 1 is the foreleg rake from the player's side. **windup2:** that paw plants as the other rises, with a visible shoulder roll and weight transfer. Hit 2 is the other foreleg. **windup3:** the dragon **sits back onto its haunches** (pitch −0.1, both forefeet planted), head drawn up to (0, 4.7, 1.7), jaw 0.35 → 0.65. **active3:** a lunging bite; forelegs take a quick double step, hind legs push, root travels ≤ 2.5 S as today | As swipe for hits 1–2; both wings pulse to 0.4 in windup3 | As swipe and bite. A parry on any hit recoils the head and shoulders back |
| **tail** (RED; 0.9 / 0.45 / 0.9; spin 200°) | **Windup:** looks over its shoulder at the player (`look` to the side), crouches (`lower` 0.25), the outside hind leg steps out wide to brace, the tail coils to the opposite side. Red glow. **Active:** the body spins about the **root** (hit math unchanged): front feet side-step twice, hind feet shuffle twice (gait at high speed), tail stiffens (`tailStiff` 2.6) and whips through, blades leading. **Recovery:** re-plant, tail settles back into its hook | Folded tight (spread 0) so the membranes don't clip the tail | Unchanged: swept arc 2–9.6 S plus tail spheres. The new tail is longer (8.3 vs 7.3), so re-measure `reach`. The tip blade is the flash point (`tailTip`) |
| **stomp** (RED; 1.0 / 0.15 / 1.0; r 4.5 S) | **Windup: rears up on the hind legs.** The hips are the pivot (pitch −0.62 as today), both forefeet leave the ground and rise to chest height, claws spread (paws at (±1.3, 4.2, 2.6)), tail presses flat as the third leg of a tripod, head high at (0, 6.0, 3.5), jaw 0.45. Red glow from the chest. **Active:** both forefeet slam down together at (±1.2, 0, 2.9) (`STOMP_Z` 2.9 unchanged); the body pitches +0.16. **Recovery:** settle, forefeet step back home | Flare to 0.6 on the rear-up, snapping down on the slam (a gust) | Zone ring unchanged. `partPos('wrists')` becomes the forefeet midpoint (rename to `'forefeet'`). Front feet are `free` while `rear` > 0.35 |
| **breath** (NORMAL, blockable, not parryable; 1.1 / 1.8 (P2 2.4) / 1.0) | **Windup:** plants all four feet wide; chest swells; **throat and chest lava charge** (`throat` 0 → 1); neck draws back and up (head (0, 5.6, 2.6)); embers at the mouth. **Active (ASCII-panel pose):** front crouch (`lower` 0.6), **neck stretched forward and down**, mouth ~1.8 off the ground; the head tracks (P1) or sweeps (P2) with the neck alone. Forelegs braced; the tail lashes slowly | **SPREAD and high** for the whole active, which is the panel silhouette. Membranes glow a bit brighter with the throat charge (membrane `GLOW[2]` 0.3) | Cone from `pt.mouth`, unchanged. The head target becomes "neck base + 2.7 S along the aim, **−0.4 S** below the neck base" (was +0.7 up), so the stream angles down |
| **fireball** (NORMAL; 0.9 / 0.35 (P2 0.9) / 0.9) | **Windup:** rears the head back high (0, 5.8, 3.0), chest puffs, throat charges, forefeet planted. **Active:** the head snaps forward and up, spitting each shell; the forelegs absorb each recoil (front bounces up 0.1). In P2 the head jerks left, centre and right for the three shells | spread 0.3, jolting with each spit | `MOUTH_Z` 5.8 → ~4.8 (re-measure: mouth forward offset when spitting) |
| **charge** (RED; 0.9 / 1.0 / 1.1; 14 S) | **Windup:** crouches on all fours (`lower` 0.55, pitch 0.18); head lowered and thrust forward **horns first** like a bull, with the head at (0, 2.4, 5.0) (was 5.6, which is out of the shorter neck's reach); **one forefoot paws the ground** as an extra tell; the tail lifts and lashes. **Active:** the bound gait from §4, body pitching per stride, head low and level. **Recovery:** forefeet plant and **skid** (dust), hind legs bunch under | Folded, lifted to 0.22 for balance (as today) | Snout r 1.15 S, chest r 1.7 S (unchanged). `CHARGE_REACH` 7.15 → re-measure (expect ~7.3) |
| **leap** (RED, P2; 0.8 / air 1.8 / 1.2; height 10) | **Windup:** deep crouch (`lower` 0.75), all four legs bunched (hind feet forward under the belly, forefeet back), head toward the landing. **Air:** launch on a downstroke (flap 0.75 at 2.4 Hz for 0.6 s) with the forelegs folded under the chest and hind legs trailing; glide at the apex (flap 0.5 at 1.8 Hz). Dive from t 1.4 with wings half-folded (0.6) and swept back and **all four legs extended down**, claws spread. **Land:** forefeet hit 0.08 s before the hind feet; wings snap fully open to brake | SPREAD in the windup and climb, 0.6 in the dive, a full snap on landing | Landing ring unchanged. Body circles stay empty while airborne |
| **roar** (RED, P2 transition and Lab; 1.2 / 1.6 / 0.6; r 7 S) | **Windup:** rises tall on straight forelegs (`lower` −0.15, chest out with pitch −0.12); the neck lifts into a big S (head (0, 6.2, 2.2)); throat and chest lava charge. **Roar:** head thrown up and forward, jaw wide, with the existing head jitter. Optionally the forefeet lift 0.3 and stamp down at the ring (pure animation). **Recovery:** wings fold back to HALF | **SPREAD** (`spreadRate` 3), shuddering (flap 0.12 at 3 Hz) | Shock ring centred on `pt.chest`, unchanged |

**Recoil, flinch and hit reactions.** On a parry the head and shoulders snap back
(`recoilTime` 0.6) and the forefeet hop back once. On a posture break, use the
stagger/posture-break pose in §4.

## 6. Build checklist: the 15 traits that matter most

(a) is recognisability in a side or three-quarter close-up (intro, Lab, death cam). (b) is
recognisability at the in-game top-down camera (58° pitch, fov 32, distance 36). "High", "med"
and "low" rate how much each trait carries the likeness at that view.

| # | Trait | (a) | (b) | Construction |
|---|---|---|---|---|
| 1 | **Four legs plus separate wings on the back** | High | **High**: four ivory claw clusters at the body's corners, wing roots on top | New `arms[]` (shoulder, humerus 1.05, forearm 1.37, hand 0.45, backward pole IK) next to the existing hind legs. Wings parented to `wingRoot` (±0.7, 3.85, 1.0) on the chest. Wings leave the gait. Front feet at x ±1.25, **outside** the 2.1-wide chest, so they show from above |
| 2 | **Bat wings: red glyph membrane, white bone lines, 4 fingers, deep scalloped and torn trailing edge** | High | **High**: the largest shapes on screen | 4 two-joint fingers [5.4, 6.0, 4.8, 3.4], 4 Coons panels, SAG 0.30/0.28/0.24/0.18, RAG teeth to 0.26. Membrane variants `'.:co' 'oeCs' 'O068'` in [0.45, 0.08, 0.05]; bones in `wingBone` at r 0.10–0.12 with `inkGlow` 0.25 |
| 3 | **High-wrist "mantled" wing silhouette** with hooked thumb claws on top | **High** | High (the wrists stand up-screen) | HALF key: wrists at (±1.5, 7.2, 1.0), fingers fanning back and down (§2.6). Thumb hook 0.9 in ivory and two orange wrist spikes. Use spread 0.3 in phase-1 combat, 0.5 in intro, taunts and phase 2 |
| 4 | **Deep chest on tall forelegs, back sloping to a lower rump** | High | Med (teardrop footprint: wide shoulders, narrower hips) | Ribcage (1.05, 1.25, 1.5) at (0, 2.85, 1.25); withers 4.0; keel 1.4; rump top 2.8. Do not level the back |
| 5 | **Molten throat-to-chest S** | **High** | Med (shows whenever the head lifts; drives the breath and roar tells) | `throat` strip under the whole neck plus the `belly` sternum plate (0.85, 0.85, 1.05) at (0, 2.25, 1.9). GLOW throat [0.65, 0.9, 1.2], belly [0.6, 1.0, 0.3]. Mixed orange glyphs `'VAUO' '8A0#'` |
| 6 | **Horned crown: long sabre main horns (V), secondary horns, cheek horns, crown, nose and jaw spikes, nape ruff** | **High** | High (an arrowhead with a V crown) | §2.1 table: main horns 1.5 at pitch −0.45, yaw π ∓ 0.22, curve 0.35. Shorten from today's 2.4 |
| 7 | **Orange dorsal spike line from nape to tail tip** | Med | **High**: the central "zipper" that reads at any distance from above | New `spine` material (ink [0.95, 0.45, 0.12], `inkGlow` 0.35, glyphs `'^A'`). One midline spike every ~0.42: 0.55 on the neck, 0.6–0.75 over the withers, 0.55 → 0.12 tail blades |
| 8 | **Short, thick S-neck carrying the head high and just ahead of the chest** | **High** | Med (a short neck reads as "dragon", a long one as "wyvern or serpent") | Chain 7 × 0.46 coiled through (0, 4.3, 1.55) to an occiput at (0, 4.85, 3.05). Radius 0.62 → 0.40. Two rows of shingle plates per segment |
| 9 | **Long tapering tail in a lateral hook, with a blade fringe and a pointed tip** | Med | **High** (half the footprint) | 16 × 0.52, `r(t) = 0.05 + 0.52(1 − t)^1.15`, `yawCurve` 0.012 for the hook. Replace the mace tip with one 0.6 blade plus two 0.2 blades |
| 10 | **Heavy ivory claws** (4 front, 3+1+spur hind) | High | High (bright dots at the 4 corners) | `claw` material ink [0.90, 0.84, 0.72], 0.42–0.58 long, curve −0.3, splayed ±0.5 rad. Glyph ramp `'\|VY'` |
| 11 | **Mixed blocky glyph hide, bright silver-white on near-black** | High | **High** (texture identity versus the grass) | `scales` and `neck` variants `'AVSD' '8B0A'` (or the `'.vA8'` fallback), ink [0.40, 0.40, 0.44], base [0.016, 0.012, 0.013], rim 0.4, cells 0.20 × 0.24 |
| 12 | **Jagged shard silhouette: elbow spike clusters, thigh and hock blades, shoulder pauldrons** | **High** | Med | Elbow 3 × (0.60, 0.45, 0.30) pointing back and up; thighs 5 × (0.50 → 0.25); hocks 2; shoulders 3 × 0.35. All `bone`, batched per joint |
| 13 | **Massive digitigrade hind legs** (knee forward, hock high) | Med | Med | Thigh `limb r0 0.72 → 0.42, bulge 0.15` plus the thigh mass ellipsoid; IK ankle offset (0, 0.75, −0.15) above and behind the toe |
| 14 | **Glowing amber eyes and a lit maw with bright teeth** | **High** | Low–med (a hot point at the head; the mouth flares in tells) | Almond eye ellipsoid (0.09, 0.06, 0.13) tilted 20°, emissive [3.2, 1.1, 0.15]. Rest jaw 0.35 shows the `maw` glow; 9 + 8 ivory teeth per side, fangs 0.16 / 0.13 |
| 15 | **Membrane crust texture and lava placement discipline** (hot chest and throat, cooler body, orange back-edge rims) | Med | Med | Membrane alt flecks 12 % [1.0, 0.38, 0.08]; `lava` strips down the back of the forearms and shins; the §2.9 strength table as `GLOW` baselines; optional warm under-rim (§3.3) |

## Appendix A: code mapping (what the rebuild touches)

**`tuning.js` `ANATOMY`.** The proposed shape is below. Positions are in the frames noted; the
root-frame results are in §1.2.

```js
export const ANATOMY = {
  withers: 4.0,                   // reference H (doc only)
  hipY: 2.4, hipZ: -1.45,         // pelvis body joint
  chest: [0, 0.45, 2.7],          // hips frame -> root (0, 2.85, 1.25)
  neckBase: [0, 0.45, 0.45],      // chest frame -> root (0, 3.3, 1.7)
  neckSegs: 7, neckLen: 0.46,
  headLen: 1.3,
  tailBase: [0, 0.15, -1.1],      // hips frame -> root (0, 2.55, -2.55)
  tailSegs: 16, tailLen: 0.52,
  hipJoint: [1.0, -0.1, 0.1],     // hips frame (x mirrored)
  thigh: 1.25, shin: 1.3, meta: 0.78,
  footHome: [1.25, 0, -1.45],     // hind toe contact, root frame
  shoulder: [1.0, -0.1, 0.6],     // chest frame: FRONT LEG shoulder joint
  humerus: 1.05, forearm: 1.37, hand: 0.45,
  handHome: [1.25, 0, 2.15],      // front toe contact, root frame
  wingRoot: [0.7, 1.0, -0.25],    // chest frame -> root (+-0.7, 3.85, 1.0)
  wingHumerus: 1.5, wingForearm: 2.05,
  fingers: [5.4, 6.0, 4.8, 3.4],
  knuckle: [0.62, 0.58, 0.6, 0.65],
};
```

**`model.js`.**
- `buildWyvern` becomes `buildDrake`, returning `arms[]` (front legs: shoulder, humerus, forearm,
  hand, toe) and `legs[]` (hind).
- `wings[]` holds root, humerus, forearm, wrist, 4 × (finger, fingerDistal), thumb and the
  membrane attach points.
- Add the `spine` material and the per-part ramps in §3.2.
- Torso meshes per §2.3.

**`membrane.js`.**
- `PANELS` 4. Slots: wrist, elbow, root, hip, plus 4 tips (and knuckles if the panels bend along
  the fingers).
- New rest layout from the SPREAD key.
- Optionally the `aEdge` and `aBoneDist` attributes.

**`rig/anim.js`.**
- Front-leg 2-bone IK with a backward pole and a wrist offset (0, 0.5, −0.25).
- Hind ankle offset (0, 0.75, −0.15).
- Wings are driven by FOLD / HALF / SPREAD keys plus flap; they are never IK'd to the ground.
- `pose.pawOv[2]` (like today's `wingOv`) for swipes.
- `pose.rear` (0..1) frees the front feet for the stomp.
- `yawCurve` in tail rest params.
- Outputs `pt.arms[k] = {shoulder, elbow, wrist, toe}` and
  `pt.wings[k] = {root, elbow, wrist, tips[4], mids[4]}`.

**`rig/gait.js`.**
- Limbs: footL, footR (hind) and handL, handR (front, `hind: false`).
- A 4-beat walk below 5 m/s; today's diagonal `GROUPS` (hind L + front R) at a trot; a bound for
  the charge.
- `stomp` already emits heavy steps for `!l.hind` limbs, so it keeps working.

**`attacks.js`.**
- `SWIPE_P*` → foreleg Bezier (§5); `swipeHit` → `pt.arms`.
- Head targets for charge (0, 2.4, 5.0) and breath (−0.4 S).
- `MOUTH_Z` and `CHARGE_REACH`: re-measure.
- `STOMP_Z` 2.9 stays.

**`dragon.js`.**
- `HURT` becomes:
  - head 0.85
  - neck 0.6 / 0.56 / 0.5
  - body 1.35 / 1.3 / 1.25
  - tail 0.55 / 0.45 / 0.35 / 0.25
  - wing: wrist 0.5 and f1-mid 0.5 per wing
  - leg: front upper arm 0.55, front wrist 0.42, hind thigh 0.65, hind hock 0.42 per side
- `partMult` is unchanged; the parts are still head, neck, body, tail, wing and leg.
- `bodyCircles`: keep chest 1.4 S, hips 1.3 S and neck base 0.9 S, and add four foot circles of
  0.45 S. The contract shape is unchanged (just more entries); `player.js` iterates the array.
- `partPos('claw')` → front paw; `'wrists'` → `'forefeet'`.
- Pushers 3 and 4 → front feet.

**Tests and docs.**
- Re-run `npm test`. REACH: the chest sphere now sits at ~5.3 m, r 2.5 m, bottom 2.8 m, still
  inside the sword band. Also re-run the swipe and bite coverage and the tail reach.
- Update `ARCHITECTURE.md` (`pt` outputs, the `'forefeet'` part name) and `STYLE.md` (creature
  row, colour rules).
- Add an ADR for "four-legged rebuild, wings separate".

## Appendix B: measurement notes and uncertainty

- The hero (90 px) stands at the depth of the near front foot. Ground lines recede from y 930
  (near front) to 870 (far hind). Heights were measured against the ground line at each part's
  depth. Expect about ±8 % on heights and ±15 % on lengths along the body axis: the body is
  turned about 18° away from the picture plane, and the tail and wing tips curve away from the
  viewer.
- Finger count: the painting's near wing shows 4 bones fanning from the wrist (leading edge plus
  3). The ASCII near wing also shows 4. The ASCII far wing resolves 3 plus the arm. Build 4.
- Neck: the painting's neck is short and thick (centreline about 0.58 H). The chain is longer
  (3.2) only so the bite can reach. If the owner prefers a strictly painting-true neck, shorten
  it to 5 × 0.46 and give the bite a bigger shoulder lunge.
- Size: the painting dragon is about 1.2× the build. The ASCII panel's is about 0.6× relative to
  its hero. The build sits between them and matches today's gameplay envelope.

## Implementation notes (v0.4 four-legged rebuild, stage 1: anatomy + locomotion)

What was built from this spec, and where it deliberately differs. Stage 2 (attack poses, §5) builds
on this.

**Files.** `tuning.js` `ANATOMY` follows Appendix A (plus `ankleOff`, `wristOff`, `hipAttach`).
`model.js` `buildDrake` (the old `buildWyvern` name is kept as an alias) returns `legs[]` (hind),
`arms[]` (front: shoulder, humerus, forearm, hand, paw) and `wings[]` (root, humerus, forearm,
wrist, `fingers[4]` + `distal[4]` joints, thumb, hipAttach, membrane). `membrane.js` has 4 panels,
NU 10 × NV 13, finger edges bent at the knuckles, `SAG` 0.30 / 0.28 / 0.24 / 0.18 and 6–8 torn
notches per panel. `rig/anim.js` holds the wing keys (`WING_KEYS`: FOLD, HALF, SPREAD, FOLD_LYING,
chest frame), the front-leg IK and `pose.rear` / `pose.pawOv` / `pose.lookDown`. `rig/gait.js`
walks the 4-beat lateral sequence. `rig/chain.js` gained `yawCurve`.

**Measured in the Lab** (model units, standing tall): withers 4.16 (ribcage top, tilted 0.28 rad
chest-up so its front pole runs into the neck base), keel 1.42, occiput (0, 4.94, 3.16) and snout
(0, 4.75, 4.19) from the
fitted S (`NECK_UP` pitch0 2.28, step −0.6, curve 0.03: the nape bulges back over the withers to
z ~1.3), front toes (±1.25, 0, 2.15), hind toes (±1.25, 0, −1.45), hocks 0.75 off the ground. Wing
wrist at HALF ~7.1. Tail: 16 × 0.52, leaves the rump ~45° down (pitch0 −0.8, +0.07 per segment) so
it lies on the ground from ~40 %, then hooks to model-right with `yawStep` 0.035 + `yawCurve` 0.017
(the 0.012 of §2.7 alone left the tip ~6 behind the root; this ends it at about (−2.4, 0, −3.4),
beside the right hind foot's line).

**Deviations from the spec (and why).**
- HALF fingers are opened ~12° wider than §2.6 (`x` +0.1–0.15) and the wrist moved to x 1.65: the
  sheet's directions are a side view, and from the front / game camera the sails were edge-on.
- SPREAD uses the critic's high key (wrist (3.2, 6.45, 0.9), no finger tip ahead of the wrist), not
  the §4 table's low forward-swept one.
- Main horns: root pitch −0.22 (not −0.45), curve 0.3: with the steeper root the tips stood as two
  vertical posts from the front. Overall they still rise ~25° above the skull line.
- Legs are ~10 % thicker than §2.4 / §2.5 (forearm r 0.40 → 0.29, shin 0.46 → 0.29, metatarsus
  0.29 → 0.23): the painting's legs are columns; the spec's radii read spindly next to the chest.
- Walk cadence: ~1.6 s per cycle at 3 m/s (stride ~2.6), not 2.1 s (stride 3.4): the forelegs
  (shoulder 2.75 up, 2.42 + 0.45 long) over-extend past ±1.3 of the home. One foot at a time,
  LH → LF → RH → RF, each swing ~25 % of the cycle; homes lead the velocity by 0.6 s (0.12 s at a
  charge) so the stride centres on the home.
- Head: kept near level (`pose.lookDown`, default 0.14 rad max nose-down + ~3° rest droop) unless
  an attack frees it (bite 1.2, breath 1.0, posture break 1.0, stagger 0.8). Jaw 1 = 0.7 rad; the
  awake baseline is jaw 0.2 (phase 1), 0.35 standing tall, so the maw glows at rest.
- Resting wings: the brain's awake baseline is spread 0.3 (phase 1) / 0.5 (phase 2, intro end,
  taunt), 0.22 while walking, as §4.
- Hide: `levels` with 6–8 variants per level (`' .:,'`, `':vco;('`, `'AVSDC5?K'`, `'8B0A69&Y'`),
  per-level ink (dim grey → warm white), `lumScale` 1.4, `glyphZoom` 0.86 (smaller glyphs, more
  black gap) and voronoi fissures (ember 0.04) instead of the glowing cell lattice. Neck material:
  `glowAxis` [0, −1, 0] so its cracks (and the throat charge) sit on the throat / under the jaw.
  Membrane ember 0.07 (0.2 lit every seam into orange stripes). Bones / horns are dimmer than the
  spec table (wingBone ink 0.74, inkGlow 0.14, rim 0.3; bone ink 0.64, inkGlow 0.08) so the wing
  arms and horns don't read as neon tubes from the game camera.
- Sleep: neck curls back along the right flank (head ~(−2.2, 0.55, 0.9)); the 3.2 chain cannot
  reach the right hind foot. Tail curls toward the head. Wings FOLD_LYING.
- Death: hips roll 0.75 rad onto the right side (not 1.2), `lower` 1.2; one wing up, one pinned.

**Gameplay contract after the rebuild.** Hurt spheres per Appendix A (23: head, 3 neck, 3 body
(deep-chest centre `pt.chestC`, waist, hips), 4 tail, 2 per wing (wrist, finger-1 knuckle), 4 per
side of legs). Body circles: chest 1.4, hips 1.3, neck base 0.9, plus a loins circle 1.15 (without
it the hero stood under the belly between the legs, where no melee attack can reach) and 0.45 per
planted foot. The swipe is a foreleg rake already (paw Bezier from §5); the AI melee bands were
re-measured in the sims: bite 3–6.5, swipe 2–5.5 up to ~75° off the nose, claw combo 3–5.4.
Stomp uses `pose.rear` and the 'forefeet' tell part. Breath: neck forward and down (−0.4), wings
SPREAD. Charge head targets moved within the short neck's reach ((0, 2.4, 5.0) / (0, 2.3, 5.2)).

**Left for stage 2.** All §5 attack performances (bite shoulder drive, rake windup roll, tail
look-back / brace, stomp tripod + slam timing on the paws, breath crouch with chest swell, fireball
recoil, charge bound + skid, leap flap / dive / land, roar stand), `MOUTH_Z` / `CHARGE_REACH` /
tail-sweep reach re-measures, the posture-break and stagger poses (front collapse), the red-tell
tint confined to ink (critic P2), the ragged-edge `aEdge` drips and `aBoneDist` gap (shader).

## Implementation notes (v0.4 four-legged rebuild, stage 2: moveset)

Every ability keeps its name, tell, windup / active / recovery, impact and `combat:flash` timing
and damage; only the performance changed. Captures: windup and impact of every ability from the
painting angle (right-front three-quarter, pitch 10) and the game camera.

**New rig controls** (`rig/anim.js` pose fields, all reset every frame): `pawPlant[2]` (a paw lands
at its `pawOv` target and becomes a ground contact; `Rig.clampPaw` pulls the spot into the leg's
reach first, because §5's rake end P2 (∓0.4, 0, 4.6) is ~3 model units beyond a planted foreleg),
`stanceF` / `stanceH` / `strideF` / `strideH` + `restep` (feet set wider / forward and re-planted:
the gait's stride threshold drops to 35 %), `hindLock` (hind feet don't step: the bite's push),
`elbowsOut` (braced breath forelegs, buckled stagger forelegs), `swell` (chest +6 % height),
`airReach` (dive legs), `droop` (DROOP wing key: stagger / posture break, tips on the ground),
`mantle` (MANTLE wing key: the breath display), plus finger folding on the flap upstroke. Two rig
fixes found while capturing: a nose-up pitch the planted forelegs can't follow (roar, breath
windup, combo finisher windup) now sits the hips back onto the haunches instead of leaving the paws
dangling ~0.5 off the ground, and the smoothed head goal is carried with the body's altitude change
(the leap landing stretched the neck straight up behind the dropping body); a look target right
under the chest (the leap lands on the hero) keeps the head forward and down instead of craning
back.

**Per ability** (§5 table → what was built):
- bite: windup sinks the shoulders (lower 0.15 → 0.35, pitch +0.1), forelegs set 0.25 wider, the
  head cocks up and back over the neck base, throat 0.3, wings flare to 0.42; active pushes off
  locked hind feet (the forelegs take the trot half-step); recovery rocks back onto the haunches.
- swipe / claw combo: the paw lifts up-and-out then cocks (a readable hitch), body rolls away,
  chest twists in, far foreleg braces; after the arc the paw slaps down and plants (dust, a light
  step) and later steps home. Combo windup3 sits back (hind feet under the haunches, both wings
  pulse, throat 0.25).
- tail: wings folded tight (spread 0), the head looks over its shoulder at the hero (the neck's
  yaw limit makes it a shoulder look), hind feet braced wide; the spin is unchanged.
- stomp: rear-up as stage 1 plus the hind brace, chest swell and a still tail; the forefeet now
  slam onto (±1.2, 0, 2.9) through `pawOv` (rate 40), plant there with dust + heavy steps, and step
  home during the recovery. The ring centre (2.9 ahead) is the midpoint of those landing spots.
- breath: windup plants all four feet wide, swells the chest, charges the throat, raises the wings
  late; active = front crouch (pitch 0.2), elbows out, mouth ~1.8 off the ground ~5.6 ahead of the
  root, wings SPREAD + MANTLE (high wrists, wide fingers: both sails read broad from the front and
  from above; a forward-swept variant closer to the panel's far wing read as wings pointing at the
  ground from the painting angle), slow tail lash.
- fireball: head rears back, chest puffs; each spit bounces the front (pitch / lower recoil) and
  jolts the wings; in phase 2 the head jerks toward each flank shell. `MOUTH_Z` 4.3 (measured).
- charge: horns first (head pitched down toward the ground ahead, `lookDown` 0.6); the forefoot on
  the hero's side paws the ground twice in the windup (dust, light steps) and re-plants; the run
  pitches per stride; the head goal leads by the run speed (it trailed ~1 model unit behind);
  recovery skids (dust off both paws) with the hind legs bunched under. `CHARGE_REACH` 6.8.
- leap: windup bunches the legs (hind feet 0.55 forward, forefeet 0.45 back); the dive reaches all
  four legs down; on landing the wings snap fully open for 0.3 of the recovery.
- roar (Lab / phase-2 transition): chest swell, the forefeet lift late in the windup and stamp down
  with the ring (dust + heavy steps), throat up to the sky.
- recoil (parry): head and shoulders snap back, the forefeet hop once, the body slides back a
  little. Stagger / posture break: the front collapses onto buckled forelegs (pitch 0.24 / 0.32),
  hind legs braced, wings DROOP to the ground; the break's head lies reachable at (0, 0.75, 4.8).
- phase 2: the combat idle stands tall (lower 0.03), jaw 0.35 (the maw glows), wings HALF.

**Re-measured** (coverage probe = the AI start path at 2–9.4 model units × 0–π rad; every AI pick
of bite, swipe, claw combo, tail and stomp lands; hits land within ~±50 ms of the flash +
`flashLead`): swipe band tightened to 2.75+ beyond 1.15 rad off the nose (a finer probe grid
missed 2.5 at 1.35 rad and 2.0 at 1.2);
tail `reach` 9.5 (tip 8.9 + sphere + hero radius). Bite, claw combo, stomp, breath, fireball and
charge bands unchanged.
*Integration check (verifier):* a finer probe (1–10 model units, every 11.25°, ±π included, both
phases, 2 s settle) found the tail sweep landing up to 0.2 s early for a hero within ~±7° of
straight behind: the windup curl (`tailCurl` `dir` × 0.06) bent the hooked tail's tip back over
him, so the spin hit on its first active frame. The windup now coils the tail away from the player
(−`dir` × 0.06, with the backswing); worst case −83 ms, and every pick still lands. Measured
spread of hit − (flash + lead) across all picks: bite −17…+67 ms, swipe −50…+33, claw combo
−17…+33, stomp 0, charge 0…+17, tail −83…+83.

**Follow-up pass** (fixes found while re-capturing every ability):
- Re-stance in place: with `restep` the gait took 0.5 s steps one foot at a time, so a 0.75–1.1 s
  windup re-planted only two feet and the breath / bite stance stayed lopsided (one forefoot at
  x 1.25, the other at 1.55). In place (`restep`, root < 1.5 m/s) the walk now takes quick 0.26 s
  steps that overlap past mid-swing; all four feet re-plant by ~0.75 s (breath: forefeet ±1.54 /
  ±1.51, hind ±1.43 / ±1.45; bite forefeet ±1.49). The breath keeps `restep` through the active
  phase. (A lower `restep` threshold, 20 % instead of 35 %, was tried and reverted: it shifted the
  Lab-forced tail sweep's first contact ~0.2 s ahead of its flash in the RED scenario.)
- A free paw (override, rear-up, airborne) hung its hand only 0.25 under the wrist, so a paw held
  on the ground by an override sank 0.2 model below it. The hand now hangs its full length; the
  stomp's paws sit on the ground.
- Stomp recovery: the forefeet stay pressed into the slam spots for the first 0.3 of the recovery,
  then plant and step home (they used to lift again in the first frames after the slam).
- Death: the upper (left) legs stiffen out straight (the right ones stay pinned under the roll).

**Still open** (outside the dragon module): the red-tell tint confined to ink (the uWarn wash turns
the whole body orange-red), the ragged membrane `aEdge` drips and the `aBoneDist` bone gap (shader
work in `src/render`); the panel's forward-swept far wing.

## Implementation notes (fix round 1: art-director review at 5 / 10)

What changed after the first art-director pass (findings P0–P1, plus what was reachable of P2), and
what is still open. Supersedes the stage-1 notes where they disagree (resting spread, wing arm,
hide material numbers). Captures: `scratchpad/art/dragon_fix_r1/*.png` (game camera at pitch 58 /
dist 38, painting angle yaw 300 pitch 8, panel angles yaw 315–330 pitch 30, close-ups).

**Wings (P0 + P1).**
- Resting spread is HALF (0.5) in both phases (`TUNING.rest`: spread 0.5, ≤ 0.3 while walking,
  jaw 0.4 / 0.65, *0.65 / 0.85 since 2026-11-08*); every attack returns to it. At 0.3 the sails were
  edge-on from the game camera.
- `ANATOMY.wingForearm` 2.05 → 2.6 (arm 4.1 ≈ 1.0 H). HALF wrist (±1.9, 7.5, 1.15) (elbow ~135°),
  fingers f0 (0.62, −0.12, −0.68), f1 (0.58, −0.5, −0.62), f2 (0.46, −0.78, −0.42),
  f3 (0.3, −0.95, −0.07): ~20–25° apart, opened toward the front so the 58° camera sees each sail's
  face (wider than the critic's numbers on f1/f2: with the sheet's back-sweep the right sail stayed
  a sliver from the front). *Superseded 2026-11-08 by the fitted HALF key (reference-match notes).*
- SPREAD (roar / leap) wrist (±2.9, 7.4, 2.1), f0 (0.82, 0.4, −0.3): the leading finger rises ~23°
  above the wrist (a dihedral), the others fan out and down with little back-sweep. MANTLE (breath)
  wrist (±2.3, 7.9, 2.0) is held in the HIPS frame (`hipsWrist`, blended by the mantle weight in
  `_updateWings`), so the front crouch no longer drags the wrists down; fingers f0 (0.8, 0.45,
  −0.22) … f3 (0.28, −0.92, −0.22). The forward wrist is what makes the far wing show its membrane
  from the front three-quarter (the panel's forward-swept far wing). Measured: roar wrists
  (±2.55, 7.44), head 5.9; breath wrists (±2.18, 6.7) with the head at 2.3. The far wing in the
  roar at yaw 315 is still mostly an upright arm (its sail shows as a strip above the back).
- FOLD wrist (±1.35, 4.6, 2.1), pole up-back: with the long forearm the old fold buried the elbow
  in the waist; FOLD_LYING moved to match.
- Wing arm (humerus + forearm) is hide (`limbs`), r 0.30 → 0.22 with 5 trailing spikes per
  segment and leading-edge serrations; only the fingers are `wingBone` (r 0.10, ink 0.58, gain 1.7,
  rim 0.2, inkGlow 0.05: thin lines, no bloom).
- Thumb hook 1.1 × r 0.17, curve −0.55, aimed up-forward (HALF (0.08, 0.78, 0.62)) with a new
  `aimJointUp` (rolls the joint so the curve hooks the tip down in front): it is the top-most bright
  shape of each wing.
- Membrane: `SAG` [0.42, 0.40, 0.34, 0.22] (one deep scallop per panel); `RAG` mostly 0–0.04 with
  1–2 irregular rips (0.12–0.18) per panel (the regular sawtooth read as feathers). `aGUV` is laid
  out once from the HALF key in 3D (`new WingMembrane(mat, side, WING_KEYS.HALF)`), so the resting
  grid is square and even; `aEdge` (0 → 1 on the free trailing edge) is computed for the shader's
  future ragged-edge discard. *2026-11-08: `SAG` [0.30, 0.28, 0.24, 0.16], deeper `RAG` rips, and the
  `wyrm` source reads `aEdge` (holes, torn edge) and a new `aBone` (orange bone streaks).* Material: `glyphZoom` 0.8, L0 glyph-filled (`'.:co'`), `inkGlow` 0.32
  (the backlit sail reads red, as a translucent bat wing does), seam ember 0.04.

**Hide (P1).** Five `levels` (`'vco:ce.o'` → `'8B0A69&Y'`, the darkest prints small letters),
pre-warmed `levelInk` [0.26, 0.23, 0.2] → [0.64, 0.52, 0.38] against the blue moon, `lumScale` 2.0,
`glyphZoom` 0.74, `inkGlow` 0.25 as the shading floor (shadowed flanks print grey glyphs).
Measured on the painting view: bright-glyph mean sRGB (199, 198, 202), B − R +3 (was +24);
blue-grey 11 % of lit pixels (was 44 %). Fissures: voronoi `crackScale` 3.5, `crackWidth` 0.7,
ember 0.015 (phase 2 × 0.45); `limbs` (legs, tail, wing arm) and `neck` add `seamAxis: 'y'` so the
fissures run along the limb. The neck no longer uses `glowAxis` (it would also mask the floor);
the throat strip carries the molten S.

**Head (P1).** Main horns splay π ∓ 0.30 (a V from the front); bone material ink 0.48, gain 1.9,
rim 0.25, inkGlow 0.02, lit glyphs only in the top level (`'A|!A'`). Teeth × 1.4 (upper fang 0.22,
lower 0.18), teeth base [0.3, 0.27, 0.23] and inkGlow 0.08; maw ink deep orange [1.0, 0.4, 0.07],
base [0.3, 0.05, 0.01], inkGlow 1.15 (a yellow-white maw swallowed the teeth). Eye ellipsoid
(0.07, 0.045, 0.11), 0.03 lower, emissive [2.2, 0.8, 0.1], `uInkGlow` eyes × 1.3.

**Neck, chest (P1).** Shingles: 3 rows per side (±40°, ±70°, ±100°), 2 per row per segment, rows
offset half a plate; pointed blades 0.50 → 0.38 long, r 0.14, flat 0.3, lifted 15°, in the `neck`
hide. Throat strip offset −0.45 r, longer overlap per segment (continuous). Sternum: `belly` with
`BELLY_LEVELS` (no chevron-heavy rows), `seamAxis 'y'`, gain 1.1, ember 0.45, plus a narrow
(sx 0.25) `throat` strip down the keel: the molten seam continues the S onto the chest.

**Claws (P1).** Front: 4 claws 0.5 / 0.6 / 0.6 / 0.5, r 0.13, rooted at the toe tips (y +0.14),
splayed ±0.5 rad with the roots spread (the right paw's claws used to cross: the x offset ignored
the side sign), arcing out and hooking down so the tips touch the ground. Hind: 0.6 / 0.7 / 0.6,
r 0.13. Paw / foot pads 0.48 / 0.46 wide, raised onto the ground (they sank ~0.15). Toe / paw joints
are aimed with `aimJointUp` (no roll: the hind foot was rolled ~20°). Claw inkGlow 0.12 (no halo).

**Not closable inside the dragon module** (need `src/render/materials.js`):
1. Upright glyphs (P1): an `upright` option on `createSurfaceGlyphMaterial` that rotates the atlas
   lookup so glyph +y follows screen-up (from dFdx/dFdy of aGUV) and never mirrors; to enable on
   scales, limbs, neck, belly, throat, lava and membrane. Today glyphs follow each part's aGUV and
   show sideways / upside down from most views.
2. Broken fissure net (P1): a per-plate-pair hash mask so only ~25 % of voronoi edges glow. Mitigated
   here with bigger, thinner plates and a 0.015 ember, but phase 2 still shows closed cells.
3. Ragged-edge drips: read `aEdge` (already on the membrane geometry) and discard a cell when
   `hash(cell) < smoothstep(0.75, 1.0, aEdge) × 0.6`.
4. A true shading floor (`levelFloor`: clamp the level input ≥ 0.3, L0 only where n·up < −0.3)
   instead of the `inkGlow` approximation, which brightens the lit glyphs a little too.

*Status 2026-11-08:* all four are closed or moot for what the player sees. The art pass prints
upright letters on a screen grid (1); the `wyrm` source draws a broken vein net and cracks only in
the scale gaps of down-facing surfaces (2), tears the membrane from `aEdge` (3) and has its own
light floor (`light.w`) (4).

## Implementation notes (reference match, 2026-11-08: the ASCII-art wyrm)

The owner attached his red-black ASCII dragon reference (thin digits on black whose brightness
draws charcoal scales, orange cracks and crimson torn sails) and asked for the dragon to look "as
identical and good as" it, with great animation. Two rounds of a look agent and a motion agent:
round 1 each had an independent reviewer / polish pass; round 2's two dragon branches were stopped
near the end and merged without their final self-report or any review (their commit messages are
the record). Supersedes the notes above where they disagree. Decisions: ADR-018, ADR-024, ADR-025.

**What the player sees.** Each material's `WYRM_ART` source (`model.js`, the `wyrm` option of
`createSurfaceGlyphMaterial`), printed in the wyrm's pixel font (`wyrmGlyphs.js`; rules in STYLE.md
"Creature ASCII art"). The surface-glyph `levels`, voronoi fissures and inks above only feed the
`uArtSolid` = 0 render.

**Art source per material** (`WYRM_ART`; all share a key light from the viewer's upper left fixed to
the camera, `key` [−0.5, 0.9, 1], greyed moonlight `envSat` 0.3, thin scale gaps `gap` [0.12, 3.5 px]
and orange under-light):
- Hide: `scales` (the barrel: roof tiles hanging from the dorsal line, `scaleDir: 'down'`, scales
  [0.48, 0.34]), `limbs` [0.3, 0.23], `neck` [0.4, 0.3] and the new `head` material (skull, brow,
  jaw, fine [0.2, 0.15] scales). Charcoal ink [0.34, 0.31, 0.29], dark scale bodies with thin bright
  free edges (tone [0, 0.11, 2.0, 0.16]), an even charcoal (`vary` 0.35), outlines by letter
  brightness only (`strokes: 'none'`), molten cracks in the scale gaps on down-facing surfaces
  (`crack` [22, 0.1, −0.4, 0.6]; `limbs` 14, `head` 12: the tail's underside read orange at 22).
- Molten undersides (`belly`, `throat`, `lava`): grey-orange scales with gold / amber rims
  (`rimInk`), lit from below, glowing gaps and cracks; the sternum is the brightest scale area, the
  throat S stays under the bloom threshold at rest and flares with the breath charge.
- Membrane: crimson [0.5, 0.045, 0.03], mottled, with holes and a torn trailing edge (`membrane`
  [0.8, 0.085, 2.0, 0.62]), orange bone streaks (`boneGlow` [0.65, 0.1, 1.05]) and round ember specks.
- Thin parts, outlined with stroke glyphs (`strokes: 'axis'`): `wingBone` (charcoal with pale edges),
  `spine` (dorsal and tail blades: grey-white, red only at the root), `bone` (horns and spikes,
  stroked only at the very edge, bright tips), `claw` (dark roots, ivory tips), `teeth`.
- `GLOW` phase-1 baselines (supersede §3.2's table): scales 0.35, limbs 0.32, neck 0.32, head 0.3,
  belly 0.5, throat [0.5, 0.9, 2.4], lava 0.5, membrane 0.35, wingBone 0.15, spine 0.3, bone 0.08,
  maw 0.55. Phase 2 wakes the hide cracks ×0.5 (more bloomed the lower body into a halo).

**Shape.**
- Head: 1.3× bigger (`HEAD_VIS`; every head mesh hangs on `headVis`, scaled about the mouth), so
  the skull, horns and mane grow back over the neck while the gameplay joints `head` / `mouth` (bite
  and charge spheres, the fire's origin) stay put. Nape frill, brow, cheek and jaw frills, 12 dorsal
  blades, a neck crest. The eye glint is a small hot-orange point (0.2 S; it was a 0.64 m
  yellow-white ball).
- Feet: eagle feet, a pad and thick knuckled toes each ending in a hooked talon bent along an arc
  (`hookGeometry`), instead of a pad with long cones that read as a rake.
- Legs ~15 % thicker (visual radii; bones and IK unchanged). The tail is drawn thicker at the root
  and tapers faster over the unchanged chain clearance; bigger saw blades, side and ventral blades,
  a barbed tip.
- Wings: distal finger bones ~1.35× longer (proximal bones and knuckles unchanged); fuller sails
  (`SAG` above), deeper rips.

**Poses and motion** (rig/anim.js, gait.js, chain.js, ik.js, attacks.js, ai.js):
- Round 1 rig fixes: twist-stable joint aiming (`aimJointStable`: no 179° / 163° / 141° per-frame
  wing flips), IK bend memory (no elbow / knee side flips), feet that step at their reach limit,
  in-place turns stepping diagonal pairs, the tail sweep's spin pivoting the planted feet, the walk
  stride centred under the shoulder, toes kept above the ground when lying, the stomp's paws landing
  on the impact frame (they hit ~5 frames early) with a coil before and a squash after. Worst-foot
  before → after: turning in place slide 1.41 → 0.01 m and float 1.61 → 0.03 m; walk float 0.56 →
  0.03 m; tail sweep toe-to-contact error 4.8 → 0.44 m; roar / phase 2 / intro slides 0.7–2.6 →
  0–0.33 m; the claw combo's rake paw drag 1.38 → 0.30 m.
- Resting display (`REST_POSE`): the neck's S carries the head ~0.45 lower and further forward
  (occiput ~(0, 4.25, 3.45)), glaring down (`lookDown` 0.45, `headDip` 0.22), jaw 0.65 open (phase 2
  0.85). Standing still it stalks (left forefoot +0.4 forward, right hind −0.3 back, the body sunk
  0.12) and `Gait.settle` steps stray feet home one at a time. Idle life (`pose.idle`): breathing
  sails, weight shifts, gaze drift, a wing rouse every ~8–11 s while it stands still.
- HALF wings (round 2 fit): wrist (±2.1, 7.5, −0.78) root frame; fingers f0 (0.629, −0.249,
  −0.736), f1 (0.953, −0.259, 0.158), f2 (0.694, −0.374, 0.615), f3 (0.173, −0.98, 0.098) (left wing,
  chest frame). Fitted by coordinate descent on the projected membrane area of both wings over the
  58° camera's whole ring of yaws plus the reference and front views: every wing keeps ≥ 0.42 of
  its area from each of them (before: down to 0.12–0.2), with the leading finger ≥ 14° below the
  wrist peak (the painting's bat M; a rising one drew a flat bar across the reference view). The
  resting sweep (`REST_POSE.sweep`) turns the wings with the head toward a foe off to one side: the
  far wing swings forward up to 0.85 rad, past the head, the near one back up to 0.35.
- Tail (`REST_POSE.tail`): level for a third of its length, then arching down (steepest ~60° near
  segment 7) to land almost tangent around segment 11 and hook. Round 2 limits stop it folding into
  a U on the ground (`TAIL_SINK`, `TAIL_DEV`); the tail sweep keeps the exact v0.4 solve
  (`pose.tailLegacy`). Worst tail joint (deg/frame): turn 24 → 9, roar 24 → 7, charge 63 → 32,
  stomp 79 → 60, posture break 43 → 15, death 49 → 17.
- Strikes (round 2, ADR-025): the shown neck spreads a strike down its length with the head pinned
  to the measured solve; the bite and the combo's lunging bite lead the shown head over their last
  three windup frames (`headLead`); the head's aim turns at most 11 rad/s except on `headExact`
  frames. Worst neck joint (deg/frame): bite 75 → 37, claw combo 40 → 31, leap 28 → 22. Swinging
  feet absorb a jump of their home (charge start / stop, a lunge: 50–65° thigh / shin pops gone),
  free feet ease home, the wing arms use soft IK.
- Parry recoil: the head is thrown up and back on an eased arc with a short dazed shake; a foot
  caught mid-step plants. Neck tip 137 → 46°, head 44 → 13°, humerus 86 → 19° per frame.
- Death (`deathPose`, ai.js): a throe (reared, head flung up, jaw wide, wings flared), the front
  buckles, the body falls accelerating onto its right side, the chest thuds at 1.1 s and rebounds,
  the head slaps down last (1.22 s, dust), one last heave. Every foot stays planted (the old stiff-leg
  overrides are gone), the wings crumple onto the ground beside the body (`pose.drape`, world space)
  and the dead tail lies in a loose curve. Foot slide 4.5 → 0.6 m.

**Gameplay checks.** Round 1: attack spheres within a few cm of v0.4 on their active frames;
first contact identical for bite (16 / 16 probes), claw combo (12 / 12) and charge (12 / 12);
swipe 13 / 16 (the three probes that missed in v0.4 now land, +33 ms); the tail sweep's median
contact −50 ms (v0.4 −58.5) and it no longer lands before its red flash (0 of 24 probes; v0.4: 5).
Round 2: every attack sphere on every active frame within 1–4 mm of round 1, except the rake paw
(up to 2.3 cm, same hit frames). The resting head's hurt sphere stays above the sword band (bottom
~5.9 m vs ~4 m); the arched tail lifts its first hurt spheres to ~3–4.5 m.

**Measured.** Reference view, round 1: body mean / ink / bright 30.0 / 22.9 / 10.9 (reference 29.0 /
21.6 / 9.0), chest 71.3 / 52.1 / 29.6 (63.9 / 45.8 / 23.8). Round 2: lit-ink colour mix white 43 /
orange 23 / red 35 % (painting 41 / 22 / 37; round 1 39 / 32 / 30); front view, orange share of the
membrane pixels 36 → 45 %. Cost (round 1): about +0.3 ms per frame on an RTX 4090 at 1080p, dragon
meshes 194 → 183.

**Still open.**
- At the reference angle the sails sit lower than the painting's, and with the hero straight ahead
  the far wing is a thin shape behind the neck: one symmetric pose cannot show both of the
  painting's wings broad from one 3/4 view (a design decision).
- In melee at 16:9 the head, neck and wings are mostly above the top of the screen (the boss camera's
  5 m zoom cap, ADR-013): the player mostly sees legs, chest and wing edges.
- Some intended fast motions still jump far per frame (charge thigh ~60°, bite neck 37°); the bite
  and leap spheres ride on them, so smoothing needs re-measuring.
- Close-ups show large, flat scale plates (no LOD toward finer scales); letters still change on
  ~39 % of the lit cells per frame at idle.
- Round 2's dragon work had no independent review.
