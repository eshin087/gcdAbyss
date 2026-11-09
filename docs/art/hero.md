# Hero visual spec: the Shadow Swordsman

A build spec for the hero, taken from the owner's concept sheets. It is written so a programmer can
rebuild the character from procedural primitives (ellipsoids, tapered limbs, lofted panels, spikes,
surface-glyph materials) in `src/entities/player/model.js`, `anim.js` and `fx.js`, and match the
art as closely as the glyph renderer allows.

Owner feedback that prompted this spec: *"The character hair and outfit doesn't look like the
images. Try to get it accurately as close as possible."*

## 0. Sources, conventions, method

| Sheet | File (session image folder) | What it shows |
|---|---|---|
| **SHADOW SWORDSMAN** | `images/1.webp` | painted front ¾ view, back view, sword turnaround, and an **ASCII GAMEPLAY** panel (idle / run / attack as glyph figures) |
| **MOVEMENT · KEY POSES** | `images/2.webp` | idle (2.4 s loop), walk (0.9 s loop), sprint (0.6 s loop), dodge (0.55 s); 6 frames each, side or ¾ view. Footer: "interpolate between keys · root travel driven by gameplay" |
| **COMBAT · KEY POSES** | `images/5.webp` | light attack 0.45 s, charge attack (hold + release), heavy attack 1.0 s; columns 01 ready, 02 windup, 03 commit, 04 strike, 05 follow-through, 06 recover |

**Conventions (same as `model.js`).**
- Model space: the origin is on the ground between the feet, **+Y up**, **+Z forward** (the hero
  faces +Z), and **+X is the hero's LEFT**, so the hero's right side is −X.
- "Left" and "right" always mean the **character's** left and right, never the image's.
- Heights are metres above the ground for a **1.80 m** figure (the current model's height).
- **hu** is one head unit, hair top to chin: **0.23 m**. The figure is **7.8 hu** tall.
- Colours are **linear RGB** (shader space). Values in `#hex` are sRGB pixels sampled from the sheets.
- Body-axis vectors (sword direction and so on) are given as `(x left, y up, z forward)`, which is
  the `swD` / `rH` convention in `anim.js`.

**Method.** Each figure was cropped and magnified 2–6×. Landmarks were measured in pixels on the
front view (930 px tall, ≈1.94 mm/px), the back view (694 px, ≈2.59 mm/px) and the sword panel
(800 px tall, ≈1.63 mm/px), then cross-checked against the key-pose frames. The painted front view
uses a slightly low camera, which lengthens the legs by about 4 %. Back-view numbers win where the
two views disagree. Expect ±5–10 % on any single number.

**Two targets.** Each part gives a **Concept** number, measured from the painting, and sometimes
an **In-game** number. The in-game number is a deliberate exaggeration that keeps the part
readable at the default camera (pitch 58°, fov 32°, distance 36 m ⇒ **≈45–52 px/m**). From that
camera, vertical surfaces are foreshortened by sin 32° = **0.53** and ground-plane extents by
sin 58° = **0.85**. The 1.8 m hero is therefore only about **45 px tall** on screen, while
horizontal spreads (coat flare, sword, pauldron points, hair rim) keep most of their size. That is
why the build checklist (§5) weights horizontal silhouette features for the top-down camera.

---

## 1. Overall proportions

### 1.1 Height ladder (1.80 m figure)

| Landmark | Height (m) | hu from ground | Notes |
|---|---|---|---|
| Highest hair flick | 1.81 | 7.85 | 2–3 short crown flicks only; **no tall spikes** |
| Skull top (under hair) | 1.775 | 7.7 | |
| Pauldron top spike tips (R shoulder) | 1.63 | 7.1 | at ear/jaw level |
| Collar top (back / front points) | 1.61 / 1.63 | 7.0 | 4–6 cm **above the chin** |
| Eye line | 1.665 | 7.25 | |
| Fringe tips (lowest bangs) | 1.645 | 7.15 | reach the nose bridge |
| Chin | 1.575 | 6.85 | head = 0.20 m chin → skull top; 0.23 m with hair |
| Shoulder top (acromion, under the coat) | 1.49 | 6.5 | shoulder joint centre ≈1.44 |
| Chest / armpit | 1.36 | 5.9 | |
| Main belt, the natural waist (narrowest) | 1.21 | 5.25 | belt stack spans 1.00–1.25 |
| Coat skirt hangs from | 1.12 | 4.9 | under the belt stack |
| Crotch | 0.88 | 3.8 | legs = **49 % of height** (anime long legs) |
| Wrist with the arm hanging | 0.95 | 4.1 | |
| Closed fist, bottom | 0.86 | 3.75 | the fist ends at the crotch line |
| Knee guard spike tip | 0.60 | 2.6 | |
| Knee centre | 0.50 | 2.2 | |
| Boot top (front, under the knee guard / back) | 0.55 / 0.47 | | |
| Coat hem, solid part: front edges / back centre / sides | 0.60 / 0.40 / 0.50 | | the coat shreds below this |
| Tatter tips: front / back / sides | 0.40 / 0.12 / 0.15 | | the longest strips sit at the back and sides |
| Ankle | 0.09 | | heel height 0.03 |

### 1.2 Widths and depths

| Part | Width (m) | Depth (m) | hu | Notes |
|---|---|---|---|---|
| Hair silhouette (front / back) | 0.24 / 0.23 | 0.25 | ≈1.05 | widest at temple height; with the hair the head reads as 1.25× the skull width |
| Skull | 0.155 | 0.18 | | |
| Collar top (outer) / collar base | 0.23 / 0.16 | 0.21 / 0.15 | | flared stand collar |
| Shoulders, deltoid to deltoid | **0.44** | 0.22 | 1.9 | back view |
| Shoulders including the pauldron / to the R spike tips | 0.52 / 0.58 | | | right side only (asymmetric) |
| Chest (coat) | 0.36 | 0.22 | | |
| Waist at the main belt | **0.27** | 0.19 | 1.2 | strong V taper from the shoulders |
| Hips (belt stack + coat) | 0.32 | 0.22 | | |
| Coat hem at rest (back view) / including tatter tips | 0.56 / 0.75 | | | |
| Coat hem in the idle breeze and in motion (¾ frames) | 1.0–1.4 | | | the tails fan out (§2.4) |
| Thigh top / knee / calf in the boot / ankle | 0.15 / 0.11 / 0.12 / 0.085 | | | |
| Boot sole length × width | 0.27 × 0.10 | | | |
| Upper arm (sleeve) / forearm with bracer / hand | 0.10 / 0.105 / 0.09 | | | |

### 1.3 Anime style cues (non-negotiable)
- **7.8 heads tall**, slim and long-legged. The crotch sits at 0.49 H and the shoulder-to-waist
  ratio is 0.44 : 0.27 (**1.63**), a sharp V. The waist is narrow; there is no bulky chest.
- The **head is small**: skull 0.20 m from chin to crown. Most of its visual mass is **hair**,
  which is wider than the face and falls over the eyes.
- The neck is **never visible**. The tall collar meets the jaw and the hair meets the collar.
- Long limbs with small hands and feet. The fists end at the crotch line; feet are 0.27 m long.
- A **long coat** forms a triangular A-line silhouette: narrow at the waist, wide and ragged at
  mid-calf.
- The **sword is longer than the legs** (concept 1.30 m total = 0.72 H) and is always held in the
  **right** hand.

### 1.4 Sword versus body
| | Concept painting | ASCII gameplay panel | Current `model.js` | Recommendation |
|---|---|---|---|---|
| Total length (pommel tip → blade tip) | **1.30 m** (0.72 H; 0.63–0.75 H across frames) | blade + glow from the gem to the glow tip ≈0.85–1.0 H | ≈1.73 m (0.96 H) | **steel 1.30–1.40 m total**, plus a glyph glow that extends **0.2–0.3 m** past the tip |
| Blade, guard → tip | 0.98 m | | 1.40 m | 1.00–1.08 m |
| Blade width at the forte | **0.08–0.085 m** | | 0.144 m | 0.09–0.10 m (in-game allowance) |
| Hit segment (gameplay) | | | `bladeBase` 0.16 → `bladeTip` 1.5 | **keep 1.5 m** (REACH test / `COMBAT.md`): the cyan glow, not steel, covers the last 0.3–0.4 m |

The painting and the owner's own ASCII panel disagree here. The panel draws the glowing blade
much longer than the painted steel. Shorter steel with a longer glow satisfies both.

*Superseded 2026-11-08 (reference match, ADR-022):* the drawn steel is **1.64 m** (pommel tip
−0.19 → `DIM.drawnTip` 1.45), so gem to point is ≈ 70 % of his height on screen, like the owner's
portrait. The animator still poses with `DIM.steelTip` 1.17 and the hit segment is unchanged; the
drawn point stays inside it.

### 1.5 Delta from the current model (what is wrong today)
Taken from `model.js` and the look-dev screenshots (`scratchpad/shots/m_views.png`,
`final_showroom_hero*.png`):

1. **Hair** is a radiating star of 16 crown spikes, 0.12–0.20 m long, pointing up and back. At game
   zoom it reads as a hedgehog or a tiara. The concept is a **mop**: a heavy fringe falls *down*
   over the eyes, side locks hang to the jaw, and only short flicks (≤ 0.04 m) rise from the crown.
2. **Head** is too big and sits too low. The skull ellipsoid is 0.25 m from chin to crown, with its
   chin at 1.505 m; the concept head is 0.20 m with the chin at 1.575 m.
3. **Torso** is three stacked ellipsoids (pelvis / spine / chest). In close-up they read as a
   "snowman" with a bulging waist. The concept torso is one tapered V-shell with an **open coat
   front**, lapels and a black shirt.
4. **Belts**: today there is one silver ring at 1.0 m plus a slanted leather ring. The concept has a
   **stack of 2 belts at the natural waist (1.13–1.23 m)**, a diagonal hip strap, drop straps, and a
   chest strap that runs from the **right** collarbone to the **left** ribs. The current strap runs
   left shoulder → right hip.
5. **Coat skirt**: today it has 9° of flare, short tatters, and a violet ink
   (`hem` ink `[0.46,0.32,0.74]`, `coat` `altChance` 0.22 violet). The concept has a 14–18° rest
   flare, long tatter strips (0.2–0.38 m) and **grey-lavender** torn edges. The figure's overall
   hue should be **neutral grey**, not lavender.
6. **Sleeve streamers** are missing: two torn cloth strips trail from the right upper arm and the
   left elbow.
7. **Sword** is 1.33× too long and 1.7× too wide in steel. The guard lacks the upswept quillons and
   the gem cage rails, and the pommel is a ball, not a kite diamond.
8. **Glyphs**: the `|` and `I` stroke ramps read as text bars ("IIII") and as a "ladder" on the
   blade. The owner's ASCII panel is built from **`A`-shaped carets**. On the limbs, aGUV +y runs
   *down* (`orient.down` without `flip`), so every `A` is drawn upside down as a `V`.
9. **Poses** (details in §4): the charge-hold, the thrust, the light-attack finish, the roll's
   sword path, the dodge duration and the slam apex all differ from the sheets.

---

## 2. Part by part

### 2.1 Hair: black mop, heavy fringe, violet sheen

**Colour.** The mass is near-black: `#050409`, linear `[0.002,0.001,0.003]`. The sheen sits on the
outer strands and flicks: `#68649b`–`#9c91c5`, linear `[0.14,0.13,0.33]`–`[0.33,0.28,0.56]`.
About 25–30 % of strands carry the sheen, concentrated on the **upper rim and the side flicks**,
never as a flat purple cap. In the ASCII panel the hair glyphs are pale lavender
(linear `[0.43,0.44,0.57]`), the only tinted part of the body.

**Volume.** A hair cap over the skull: ellipsoid radii **(0.092 W, 0.108 H, 0.104 D)** centred
1 cm behind the skull centre. That is 1.18 × 1.08 × 1.15 the skull, with thickness 0.015 m at the
temples and 0.03 m on the crown and back. The clumps below hang off this cap.

**Clump layout.** Head space: the origin is the skull centre (≈1.675 m), with model axes.

| Group | Count | Root position | Direction | Length | Root width | Notes |
|---|---|---|---|---|---|---|
| **Fringe (bangs)** | 7 | an arc across the front hairline: x −0.06…+0.06, y +0.07…+0.085, z +0.065…+0.08 | **down 70°**, forward 20°, swept 10–15° toward the hero's LEFT | centre 3: **0.10–0.12** (tips at the nose bridge, 1.645 m); outer 4: 0.07–0.09 | 0.03–0.035 | Tips hang 1–2 cm in front of the face and curl slightly inward. One long strand crosses the **right eye** and covers it. The left eye shows between strands. |
| **Left side lock** (hero's left) | 3 | temple x +0.075, y +0.03…−0.01, z +0.02…+0.035 | 1 flick out/back/down; 1 **long lock straight down in front of the ear to the jaw** (tip at 1.59 m, curling outward); 1 swept back over the ear | 0.08 / 0.11 / 0.09 | 0.03 | The left side is **longer** than the right |
| **Right side** (hero's right) | 3–4 | above the ear, x −0.075, y +0.02…+0.05 | swept **back** and out over the ear | 0.06–0.08 | 0.025–0.03 | The **right ear is exposed** below them |
| **Crown flicks** | 6–8 | upper skull, elevation 45–80° | up and out, the tips curling back/down (cowlick) | **0.03–0.06** | 0.02 | Rise ≤ 0.04 m above the skull. 2–3 stand near-vertical to make the jagged top edge. **No radiating star.** |
| **Side flicks** (back-side, at ear height) | 4–6 per side | x ±0.08, y −0.01…+0.04, z −0.02…−0.06 | **horizontally outward**, slightly back | 0.04–0.06 | 0.015 | The jagged side edges of the back silhouette; this is where most of the violet sheen sits |
| **Nape locks** | 5–7 | back of the head, y −0.02…−0.06, z −0.08 | down to the collar top (1.61 m), tips flicking out 10–20° | 0.07–0.10 | 0.03 | Stop **at** the collar, never over it |

**Silhouettes.**
- **Front:** a rounded mop 0.24 m wide at temple height, narrowing to about 0.20 m at the crown.
  The top edge is jagged with 5–7 small flicks. The lower edge is the jagged fringe line across the
  eyes at 1.645 m. On the hero's left a lock hangs to the jaw; on the right the hair ends above the
  ear. The visible skin is a small inverted triangle, 0.07 W × 0.06 H, between the fringe and the
  collar.
- **Side (profile):** a windswept rounded helmet with a spiky edge. The fringe juts 2–3 cm ahead of
  the forehead and hangs to the nose bridge. The crown flicks point back and up, and the back hair
  falls to the collar. Overall depth is 0.25 m.
- **Back:** a messy mop 0.23 m wide. Side flicks stick out horizontally, pointed nape locks touch
  the collar, and the tip of the right ear shows.
- **Top-down (game camera):** an irregular dark disc about 0.24 × 0.26 m with **10–14 rim points**
  (fringe points at the front, flicks at the sides). The crown whorl sits slightly behind centre,
  and violet glints run along the rim.

**Motion.** Hair lags motion, which today's spring clusters already handle. In sprint and dodge
the clumps stream back 15–25°. During the slam apex (heavy 03) the fringe lifts off the eyes.

### 2.2 Face
- Pale skin: base `#c8a59f` → linear `[0.58,0.38,0.35]`, highlight `#d7c0c1` →
  `[0.68,0.53,0.53]`.
- A slim **V-jaw** with a pointed chin, a straight small nose, a thin closed mouth line and a cool,
  slightly downcast expression. In the painting the head is turned 20° toward the hero's left and
  pitched 10° down.
- **Eyes:** the right eye is covered by the fringe. The left eye is visible between strands:
  narrow, half-lidded, with a grey-violet iris. The eyebrows are hidden.
- The **right ear** is exposed, a normal anime ear. The left ear is hidden by the side lock.
- In game the face is 1–2 cells. Render it as dim skin glyphs (`.:o`) in the gap between the hair
  and the collar. Its job is only to break the dark hair-collar mass with a sliver of warm light.

### 2.3 Collar
- A **tall stand collar** belonging to the coat. At the back it runs 1.51 → **1.61 m** (0.10 m
  tall). The front corners rise to **1.63 m** at the jaw corners, 5 cm above the chin, and stand
  slightly away from the jaw.
- It **flares** outward from a base radius of 0.08 m to a top radius of 0.115 m (≈25° outward
  lean). The top edge rolls out 1 cm. Thickness is 0.012 m.
- It **opens at the throat in a V**: 0.06 m wide at the top, closing to 0.02 m at 1.50 m. The black
  shirt's own mandarin collar (0.035 m) shows inside the V.
- The front edges turn down into **narrow lapels** (0.05–0.06 m wide) that fold outward to about
  1.40 m and then become the open front edges of the coat.
- Colour: outside black (`coat`). The **inner face is blue-violet**, `#635d81` → linear
  `[0.125,0.109,0.22]`, visible where the collar flares. A thin light rim (piping) runs along the
  top edge.
- In silhouette the collar fills the space between the shoulders and the hair, so the head appears
  to sit *in* the collar. From the back the hair touches it.

### 2.4 Coat: long black greatcoat, open front, shredded tails

**Upper coat (torso and sleeves).**
- Fitted black coat: `#232026` → linear `[0.017,0.014,0.019]`. Highlights are cool grey
  `[0.2,0.17,0.18]`.
- The **front is open** from 1.45 m down. The gap between the front edges is 0.08 m at the sternum
  (1.42 m), 0.16–0.18 m at the belt (1.21 m), and the skirt edges part to 0.25–0.35 m at the hem,
  so the legs show in front.
- **Piping:** a 5 mm grey-violet line runs along the front edges, the lapels and the hem. It is
  the brightest line on the coat: `#807275`–`#635d81` → linear about `[0.2,0.17,0.2]`.
- The sleeves reach the wrist and are fitted, with the forearm armour worn over them (§2.8).
- **Back:** a curved **yoke seam** dips from both shoulder points to 1.36 m at the centre. A dark
  grey-violet **diamond / spearhead emblem** (0.06 W × 0.10 H, line art) sits between the shoulder
  blades at 1.38 m. Two princess seams run down to the waist.

**Skirt (from the belt stack at 1.12 m).** There are six panels plus a front flap. A **back vent**
splits the back from 0.95 m down.

| Panel (azimuth from +Z, + = left) | Width top → hem (m) | Solid part to (m) | Torn strips | Strip tips at (m) | Notes |
|---|---|---|---|---|---|
| Front-left (+0.75 rad) | 0.13 → 0.20 | 0.60 | 3 | 0.40–0.46 | Its front edge is the open coat edge; shortest panel |
| Front-right (−0.75) | 0.13 → 0.20 | 0.60 | 3 | 0.40–0.46 | Hangs behind the sword |
| Left (+1.6) | 0.18 → 0.30 | 0.50 | 3–4 | **0.15**–0.30 | Most blown out in the painting's idle |
| Right (−1.6) | 0.18 → 0.30 | 0.50 | 3–4 | 0.15–0.30 | |
| Back-left (+2.55) | 0.17 → 0.30 | 0.40 | 4 | **0.12**–0.28 | Back vent between back-left and back-right |
| Back-right (−2.55) | 0.17 → 0.30 | 0.40 | 4 | 0.12–0.28 | |
| Front flap (0) | 0.12 constant | from 1.05 to 0.55 | pointed tip | 0.55 | Hangs between the legs; seen in wide stances (charge 01–02, light 03–04, heavy 05). Black, with a violet lower 0.10 m and a small diamond emblem |

- **Rest flare:** 14–18° from vertical, so the hem radius is about 0.30–0.35 m around the hips. This
  is a compromise between the still back view (≈10°) and the breezy ¾ idle frames (≥ 20°). The
  idle breeze adds ±6°, and the back-left tails sit most blown out. In the ¾ idle frames the hem
  fans to 1.0–1.4 m across. That wide ragged triangle is the coat's identity.
- **Tatter strips (20–22 in total).**
  - Size: 0.06–0.12 m wide at the tear root, **0.15–0.38 m** long. The back and sides carry the
    longest.
  - Shape: each tapers to a sharp point. The tip curves outward and backward 15–30°, like a
    claw. One strip in four **forks** into two points over its last third.
  - Edges are jagged, with a 1–2 cm notch every 3–5 cm.
  - **Holes:** 2–4 irregular burn-like holes per panel, 0.02–0.05 m across, in the lower 0.25 m of
    the solid part.
- **Colour gradient on the tails.** The outside is black down to about 0.15 m above the tear line.
  From there it lightens into a **dusty grey-lavender**, `#7d729b` → linear `[0.205,0.168,0.328]`,
  with darker irregular blotches. The **"purple torn edges"** are a 0.02–0.04 m band of
  `#797192` → `[0.19,0.165,0.29]` along every torn edge. It is lavender-grey, **not saturated
  purple**.
- **Lining:** deep indigo, `#2d2c55` → linear `[0.026,0.025,0.091]`, with a faint diamond (argyle)
  line pattern in `[0.07,0.065,0.2]` (line spacing 0.06 m). It shows inside the flare and on the
  back of strips that flip over.
- **Behaviour.** Walk: the tails trail 15–20° behind vertical. Sprint: the tails stream nearly
  horizontal (60–75° from vertical). Dodge: the tails are flung up over the back. Slam and wide
  stances: the hem pools wide (30°). The ragged tips lag the panel by 0.1 s, so each **strip** should
  sway, not only each panel.
- *Built 2026-11-08:* hems at the tear line 0.30 m (front), 0.60 m (sides), 0.55 m (back); a resting
  `flare` per panel (front 0.22, sides 0.5, back 0.3; `COAT_FLARE` 0.3 ≈ 16°) plus an asymmetric
  idle flare while standing (`IDLE_FLARE`: front 0.02 / 0.06, sides 0.3 / 0.62, back 0.22 / 0.45);
  soft vertical folds deepening toward the hem; the lower 55 % of each lower segment is the lavender
  torn zone (`hem`). Burn holes and blotches are still not modelled (§7.2).

### 2.5 Shirt
- Black fitted shirt: `#20232b` → linear `[0.014,0.017,0.024]`, slightly bluer than the coat.
- A **mandarin collar** 0.035 m tall shows inside the coat collar's V.
- A **column of 6–7 small buttons** (0.008 m, 0.03 m apart) runs down the centre, with horizontal
  fold creases across the chest.
- It shows only in the coat's open V, from 1.52 m to the belts at 1.23 m, 0.06–0.16 m wide.
- There is no vest; the straps (§2.6) cross the shirt.

### 2.6 Belts and straps
Leather is a dark brown-black: `#211c20` → linear `[0.015,0.012,0.014]`, highlights
`[0.08,0.065,0.06]`. Buckles, rings and rivets are silver: `#aba4b2` → `[0.41,0.37,0.45]`, the
brightest small metal.

| # | Strap | Path | Width | Hardware |
|---|---|---|---|---|
| W1 | Main waist belt | horizontal at **1.21 m**, all the way round | 0.035 | Rectangular silver buckle, 0.045 × 0.035, front, 3 cm left of centre; 4–5 rivets |
| W2 | Second belt | 1.17 m on the hero's left → 1.13 m on the right (5° tilt), all the way round | 0.03 | Buckle front-right, 4 cm right of centre |
| H1 | Diagonal hip strap | from the **left hip (1.13 m, x +0.15)** down across the front to the **right thigh (0.95 m, x −0.12)**, wrapping the right thigh and coat edge; ≈28° | 0.03 | Square buckle on the right upper thigh at 1.00 m |
| D1 | Centre drop strap | vertical from W2 at the centre down to 0.93 m | 0.025 | D-ring at 1.07 m, pointed metal tip at the end |
| D2 | Right drop strap (sword hanger) | from H1 down the right thigh to 0.85 m | 0.025 | ring |
| C1 | Chest / pauldron harness | from the pauldron's inner edge at the **right collarbone (1.47 m, x −0.06)** diagonally down across the shirt to the **left ribs under the armpit (1.28 m, x +0.14)** | 0.025 | small buckle at 1.42 m, 2 rivets |
| A1 | Right upper-arm strap | around the upper arm at 1.30 m, just below the pauldron | 0.02 | buckle on the outer side |
| A2 | Left upper-arm strap | around the upper arm at 1.25 m, above the elbow | 0.02 | buckle on the outer side (seen in the back view) |
| K1–K2 | Knee-guard straps, each leg | at 0.56 and 0.51 m | 0.015 | |
| Back | Belt stack seen from behind | 3–4 bands overlap and cross at ±10° between 1.00 and 1.26 m; buckle at the back-right | | A loose strap end hangs diagonally from the back centre (1.05 m) down to the left (0.90 m) |

In game the belt stack should be **the brightest band across the torso**: silver buckles drawn in
`trim` glyphs on dark leather. It is the waistline marker that separates the torso from the
flaring skirt.

### 2.7 Pauldron (RIGHT shoulder only)
- Dark gunmetal, `#392d31` → linear `[0.041,0.026,0.031]`, with **silver-blue bevels** of
  `#9fa2d1` → `[0.35,0.36,0.64]` on every plate edge (0.008–0.012 m wide). Each plate carries one
  bright highlight streak. The left shoulder is **plain coat**.
- **Plates (lames)** step down the arm from the collar edge to about 0.12 m above the elbow
  (1.27 m). The plates stand 0.02–0.04 m off the arm and black gaps show between them.

| Plate | Covers | Size (W × H × D, m) | Points |
|---|---|---|---|
| P1 cap | the shoulder top, from the collar edge to the deltoid | 0.13 × 0.06 × 0.15 dome | its rear/top edge is cut into **3 upswept blades**: S1 inner, by the collar, 0.08 m, up and slightly in/back; **S2 middle, tallest, 0.12 m, up-back-outward**; S3 outer, 0.09 m, outward-up at 45°. The tips reach **1.62–1.64 m**, ear level. |
| P2 | the upper deltoid | 0.14 × 0.06 × 0.15 | S4: 0.07 m horizontally outward. **S5, the front fang:** a triangular plate 0.10 m long pointing **down over the right pectoral** toward the chest, the big "arrowhead" in the front view |
| P3 | mid upper arm | 0.12 × 0.05 × 0.13 | S6: 0.06 m down-back |
| P4 | lower upper arm, to 1.27 m | 0.11 × 0.045 × 0.12 | S7: 0.05 m down-back |

- The **front view** reads as an asymmetric spiky mass that juts 0.08 m beyond the deltoid (0.14 m
  to the spike tips), with the top points at jaw level and the fang over the chest.
- The **back view** reads as a **crown of 3 tall upswept blades** above the right shoulder plus the
  stepped plates below. This is the dominant back-view feature.
- **Top-down:** a 6–7-point star on the right shoulder. Point S2 and S3 outward, not straight up,
  so they read from above.
- C1 holds it on (§2.6). It follows the arm partially; the current `PAULDRON_FOLLOW` of 0.35 is
  fine.

### 2.8 Arms

| | Right (sword arm) | Left (free arm) |
|---|---|---|
| Upper arm | black coat sleeve under the pauldron, strap A1 | black coat sleeve, strap A2 above the elbow |
| Elbow | the vambrace's top flares into a **point 0.06 m up toward the elbow**, on the outer side | the bracer's top flares to a smaller pointed edge (0.04 m), on the outer side |
| Forearm | **full plate vambrace**, 0.20 m long: 3 overlapping lames with silver bevels and a **0.04 m spike** at the outer wrist. Forearm diameter with the armour is 0.105 m | **dark leather bracer** with 2 thin metal bands (0.012 m) |
| Wrist | covered by the gauntlet cuff | **silver cuff ring, 0.025 m wide** |
| Hand | **armoured gauntlet**: articulated plates on the back of the hand and on each finger, dark, silver edges, full fingers | **fingerless black glove**: skin tips (0.02 m) on every finger, fingers loosely curled |
| Streamer | **torn strip from the back of the upper arm, under P4** (≈1.33 m): 0.07 m wide, **0.45–0.6 m** long, black at the root, lavender-grey toward the ragged end | **torn strip from the back of the elbow** (≈1.17 m): 0.06 m wide, **0.35 m** long, lavender-grey with holes |

The streamers are attached at the root and hang on springs. They hang down and out 20° at rest,
**stream horizontally back** in walk and sprint (seen in every walk and sprint frame at shoulder
height, up to 0.6 m behind), and whip up in the dodge.

### 2.9 Pants
- Black and slim, slightly full at the thigh: `#111116` → linear `[0.006,0.006,0.008]`, the
  darkest cloth.
- Tucked into the boots below the knee, with a vertical outer seam and soft horizontal folds at the
  knee.
- Strap H1 crosses the right thigh, and the knee-guard straps sit at the knees.

### 2.10 Boots and knee guards
- **Boots:** knee-high, armoured, sabaton style. Body colour is `#2a2c3e` → `[0.023,0.025,0.048]`,
  with plate-edge highlights matching the pauldron's bevels.
  - Top at 0.55 m in front (under the knee guard) and 0.47 m behind.
  - The shin is covered by **3 overlapping lames**, each 0.07 m tall, narrowing toward the ankle.
  - **2 small instep lames** sit over the foot, with a rounded, slightly pointed toe cap.
  - A **bright silver welt line** runs round the sole edge, which is the boot's most visible
    highlight.
  - Heel 0.03 m. Calf width 0.12 m, ankle 0.09 m, foot length 0.27 m.
- **Knee guards (poleyns), both legs:** a kite-shaped plate, 0.10 W × 0.13 H, centred on the knee.
  - The top point rises **0.08 m above the knee** (tip at 0.60 m) and leans 15° outward.
  - Side wings wrap 0.03 m round the knee, with a ridge down the middle and silver bevels.
  - 2 straps (§2.6) hold it on.
  - From the back the wing edges show as small points at the back of the knee.
- *Built 2026-11-08:* a **kite greave** down each shin (a faceted diamond plate with a raised ridge
  and bevels, cuff lames under the knee and at the ankle) replaces the 3 stacked ring lames, which
  read as a barrel.

### 2.11 Sword
Sword space follows `model.js`: the origin is the **grip centre**, the blade runs along **+Z**, the
blade's width lies along X and its flats face ±Y. Concept numbers come from the sword panel,
scaled to 1.30 m total.

| Component | z range (m) | Size | Shape and colour |
|---|---|---|---|
| **Pommel** | −0.19 → −0.09 (with its collar) | 0.10 long, 0.04 wide, 0.025 thick | An elongated **kite / rhombus** with a sharp point at the far end. Faceted, with a silver rim around a dark centre facet. A silver collar ring (0.015 m) sits at its base. |
| **Grip** | −0.08 → +0.08 | 0.155 long, radius 0.012 | Dark leather with a **criss-cross diamond wrap** (a lattice of 0.015 m rhombi). Silver ferrules at both ends. Fits about 1.7 hands; two-handed poses stack the hands. |
| **Crossguard bar** | +0.08 → +0.125 | span **0.20** (quillons ±0.10) | A central block with two quillons that **sweep back toward the pommel**: the tips are 0.03 m above the bar and end in sharp points with a small inner hook. Gunmetal with silver bevels. |
| **Gem cage** (on the blade's forte) | +0.10 → +0.36 | 0.11 wide at the top, narrowing to the blade width | Two **outer silver rails** leave the quillon roots and run down the blade. Each carries **3 notches / outward barbs** (0.015–0.025 m), so the outline looks scalloped. A **pointed diamond frame** in the centre holds the gem, and the central ridge starts below it. |
| **Gem** | centre +0.16 | rhombus **0.03 W × 0.055 H**, 0.02 thick, proud of **both** flats | Saturated violet: `#8d3ce3` → linear `[0.27,0.045,0.77]`; ASCII panel `[0.37,0.26,0.51]` average. A **white-hot 4-point star glint** sits at the centre. It glows (bloom, about 3 cells wide in the ASCII panel). |
| **Blade** | +0.125 → +1.105 (concept tip) | 0.98 long. Width **0.085** at the forte, 0.068 at z +0.95; the last 0.13–0.15 m taper to a long sharp point. Thickness 0.012 at the ridge, 0.002 at the edges | The flats are **faceted cold blue-grey steel**, `#5a6b8e` → `[0.10,0.15,0.27]` (crystal-like planes). A **bright silver centre ridge**, 0.004 m, runs the full length. **Each edge** carries a 0.006 m **glowing cyan line**, `#89ddf0` → `[0.25,0.72,0.87]` (core near white), with a soft outer glow of about 0.02 m. The tip is the brightest point. |

Concept total: −0.19 → +1.105 = **1.30 m**. By share of total length: pommel 7.5 %, grip 12 %,
guard 3.5 %, blade 76 %.

- **In-game:** steel tip at z +1.11–1.21 (total 1.30–1.40 m), which keeps the concept's
  proportions slightly enlarged (width 0.09–0.10 m). Add a **0.2–0.3 m glyph glow past the tip** (the panel's dotted halo, §3)
  so the visual reach matches the unchanged 1.5 m hit segment.
- **Hand placement:** one-handed, the right hand sits right under the guard with its centre at
  z ≈ −0.01. Two-handed, the left hand goes below the right, toward the pommel (the
  `TWO_HAND_GRIP` 0.11 m offset is right).
- **Silhouette:** a long blade with parallel edges. The wide "T" guard has upswept horns and a
  scalloped cage, which makes the hilt end clearly bulkier than the blade (0.20 vs 0.085 m). The
  violet point marks the hilt.

### 2.12 Back-view differences (summary)
- The pauldron shows as **3 tall upswept blades** over the right shoulder.
- The coat back carries the yoke seam and diamond emblem. The **back vent** splits the skirt from
  0.95 m down. The lower back panels show the grey-lavender vein/blotch pattern and taper into the
  longest strips (tips at 0.12 m). The tails look narrower than in the front view (0.56 m solid,
  0.75 m to the tips) because the back view is not blown by the breeze.
- The belt stack wraps all the way round: 3–4 crossed bands, a buckle at the back-right, and a
  hanging strap end on the back-left.
- Hair: nape locks touch the collar, side flicks stick out, and the right ear tip shows. The collar
  is a uniform tall band hiding the neck.
- Both forearms show armour with flared pointed elbow tops. Both gloves look dark from behind.
- Boots: calf lames, heel, and the knee guards' side wings.

### 2.13 Colour summary
| Part | Painting sRGB | Painting linear | Suggested glyph **ink** (in-game, linear) | Gap **base** |
|---|---|---|---|---|
| Hair mass / sheen | `#050409` / `#9c91c5` | `[.002,.001,.003]` / `[.33,.28,.56]` | `[0.42,0.42,0.58]`, alt `[0.60,0.45,1.00]` @ 25 % | `[0.006,0.005,0.012]` |
| Skin | `#c8a59f` | `[.58,.38,.35]` | `[0.85,0.72,0.66]` | `[0.05,0.035,0.03]` |
| Coat outer | `#232026`, piping `#807275` | `[.017,.014,.019]` | `[0.50,0.50,0.56]`, alt `[0.60,0.58,0.70]` @ 12 % | `[0.007,0.007,0.011]` |
| Collar inside / lapel facing | `#635d81` | `[.125,.109,.22]` | `[0.30,0.27,0.55]` | `[0.012,0.010,0.03]` |
| Tails, torn zone | `#7d729b`, edges `#797192` | `[.205,.168,.328]` | `[0.46,0.43,0.60]`, alt `[0.62,0.42,0.98]` @ 30 % | `[0.012,0.008,0.02]` |
| Lining | `#2d2c55` | `[.026,.025,.091]` | `[0.22,0.20,0.55]` | `[0.012,0.010,0.035]` |
| Shirt | `#20232b` | `[.014,.017,.024]` | `[0.40,0.42,0.50]` | `[0.006,0.006,0.010]` |
| Pants | `#111116` | `[.006,.006,.008]` | `[0.40,0.40,0.47]` | `[0.005,0.005,0.008]` |
| Leather straps | `#211c20` | `[.015,.012,.014]` | `[0.42,0.36,0.32]` (as today) | `[0.012,0.009,0.008]` |
| Silver (buckles, bevels) | `#aba4b2` / `#9fa2d1` | `[.41,.37,.45]` / `[.35,.36,.64]` | `[0.80,0.84,1.00]` | `[0.025,0.027,0.032]` |
| Dark metal (pauldron, vambrace, boots) | `#392d31` / `#2a2c3e` | `[.04,.03,.03]` / `[.023,.025,.048]` | `[0.50,0.53,0.66]`, alt `[0.72,0.76,0.92]` @ 25 % | `[0.012,0.013,0.02]` |
| Blade flats / edge glow | `#5a6b8e` / `#89ddf0` | `[.10,.15,.27]` / `[.25,.72,.87]` | ink `[0.45,0.95,1.35]`, alt `[0.80,1.20,1.70]`; emissive `[0.3,1.25,2.6]` | `[0.02,0.03,0.05]` |
| Gem | `#8d3ce3` + white core | `[.27,.045,.77]` | ink `[1.3,0.55,2.4]`, emissive `[1.6,0.45,3.0]` (as today) | `[0.30,0.08,0.50]` |

**Hue budget:** the body glyphs are **neutral to slightly cool grey** (B/R ≤ 1.15). Violet appears
only on the gem, the hair sheen, the collar inside and the torn edges. Cyan appears only on the
blade and its FX. Today's figure reads lavender all over (screenshots), which is the biggest colour
miss.

---

## 3. The ASCII GAMEPLAY panel, and how to render it here

### 3.1 What the panel shows (measured)
- **Background** pure black (`#0c0b0e`). **No drawn outline:** the silhouette is simply where the
  glyph cells stop, which gives a ragged, cell-quantised edge.
- **Strict terminal grid.** Cells are about 8.6 × 8.8 px on the sheet (square cells, glyphs
  slightly taller than wide). The idle figure is about **30 rows tall** (cell ≈ H/30 ≈ 0.06 m).
  Shoulders span about 11 columns, the waist about 7, each leg 2–3, and the coat hem fans to about
  20 columns. **Columns line up vertically (no row offset).**
- **Glyph vocabulary** by frequency:
  - The caret family **`A` / `Λ`** fills about 50 % of the lit cells. (`Λ`, `Δ` and `∧` are not in
    our atlas, so use `A` and `^`.)
  - Dense glyphs **`8 B 0 D Q P R`** (about 15 %) cluster on the chest, shoulders, the lit flank of
    the coat and the thighs.
  - Mid glyphs **`^ ? / 1 !`** take about 15 %.
  - Sparse **`' . : ; , -`** take about 20 %, on shadow sides and along limb edges.
  - **10–25 % of interior cells are blank:** the arm/torso boundary, between the legs, between coat
    strips. Those gaps carry the form.
- **Density:** lit pixels cover **13–15 %** of the figure's bounding area. Glyphs are thin and the
  black dominates.
- **Colour:**
  - **Body:** neutral light grey, average `#bfbfc1` (linear ≈0.52), brightest `#fcf9fc`.
  - **Coat tails:** a touch bluer, `[0.48,0.48,0.55]`.
  - **Hair** (top 2–3 rows): lavender, `[0.43,0.44,0.57]`.
  - **Gem:** a 3×2-cell blob of saturated violet `[0.27,0.045,0.77]` with a white core and a soft
    bloom about 3 cells wide.
  - **Blade:** pale cyan-white glyphs (`A ^ /`), average `[0.31,0.45,0.53]` and tip `[0.87,1,1]`.
    A **one-pixel white dashed core line** (`- - -`) runs down the blade centre. Around the blade
    a **halftone of `.` dots** on the grid fades out over 3–4 cells on each side: the glow is drawn
    with dots, not blur.
- **Coat tails** are **4–6 finger-like columns** of `A`, each 1–3 cells wide, that taper to single
  `'`, `1` or `.` cells. They fan backward in all three poses.
- **Run pose:** the body pitches 35° forward in a long stride, the left arm reaches forward and
  down, and the sword arm trails back with the blade level and low behind. The blade's dot halo
  smears back into a **speed trail about 2 blade lengths** long. The coat strips stream
  horizontally.
- **Attack pose:** a lunge with the blade straight forward, the coat tails fanned back like a claw
  (5–6 strips), and a **giant crescent arc** in front.
  - The crescent runs from above the head round the front to below the hip, a `)` about 1.2–1.3 H
    tall.
  - Its leading edge is 1–2 cells of the brightest glyphs (`A 8` in white-cyan). Behind that come
    2–3 cells of curved glyphs following the arc (`) >`), then a **regular dot field** (`+` near
    the edge, `.` further out) fading over about 6 cells.
  - The far end tapers into a thin line of `+`.

### 3.2 Translation to `createSurfaceGlyphMaterial`
*Superseded for what the player sees:* since v0.4 the hero is ASCII art of a shaded source, and
since 2026-11-08 he is **ink-line art** (§7.2, ADR-019 / ADR-020): a flat fill per part
(`HERO_INK`) printed as dim letters inside bright ink lines the art pass traces per pixel. The
surface-glyph table below only shapes the `U.uArtSolid` = 0 look-dev render.

The game cannot use 0.06 m cells: they would be 2–3 px at the default camera, the v0.1 "too solid"
failure. Keep **glyph shape over glyph count**. Cells of 0.11–0.13 m wide and 0.17–0.20 m tall on
vertical surfaces come out about 5–6 px square on screen, because vertical extents shrink by 0.53.
That gives about **10–14 rows** for the whole figure.

**Rules:**
1. **`A`-family ramps.** Every cloth or body ramp ends in `A` or `8`, never in `|` or `I` (those read
   as text bars). Each ramp's darkest glyph is a stroke or apostrophe (`'` or `:`), not a lone `.`,
   so shadowed parts still read as a figure.
2. **Glyphs stand upright.** aGUV **+y = up the body at rest** on the torso, coat, sleeves, pants
   and boots, so every `A` points up as in the panel. On limbs built with
   `orient.down(limbGeometry(...))`, pass **`flip: true`**: without it aGUV y runs down the limb
   and the `A` renders as `V`. This deliberately departs from the creature rule ("+y toward the
   tip"). The exceptions are the **hair clumps, pauldron spikes and blade**, where +y runs toward
   the tip, so their `A` and `^` point along the spike and read as points.
3. **`rowShift: 0`** on the torso, pants and boots gives the panel's aligned columns, such as the
   columns of `A` down each leg. Use **0.5** on hair and tatters, which are organic and must not
   look typeset.
4. **Neutral ink, tinted accents** (§2.13 hue budget). Cut the coat's violet `altChance` to about
   0.1. The tails' alt ink is the only cloth violet.
5. **Outline ≤ 1.3.** The panel has no outline; the moonlit `outline` exists for readability on dark
   grass. Keep it thin and cool, because a thick one turns the figure into a lit mannequin.
6. **Gaps:** keep `base` at 0.005–0.012. The panel's black is about 0.004.
7. **Blade:** 2 glyph columns, one per blade half, with **seams on the edges and the ridge**, which
   `bladeGeometry` already does. Change the ramp to `'^AA` so the blade shows chevrons pointing
   toward the tip instead of a `|=|` ladder. Draw the white core line with the ridge seam, giving
   it a little `uGlow` at idle.

| Material | `glyphs` | `cell` [w,h] | `rowShift` | `ink` | `inkAlt` / `altChance` | `base` | `outline` / `rim` | `inkGlow` | `lumScale` / `gain` |
|---|---|---|---|---|---|---|---|---|---|
| `hair` | `'^AA` | [0.11, 0.12] | 0.5 | [0.42,0.42,0.58] | [0.60,0.45,1.00] / 0.25 | [0.006,0.005,0.012] | 1.2 / 1.2 | 0.5 | 5 / 2.6 |
| `skin` | `.:oo` | [0.09, 0.09] | 0 | [0.85,0.72,0.66] | — | [0.05,0.035,0.03] | 0.8 / 0.4 | 0.4 | 4 / 1.8 |
| `coat` (torso shell, sleeves, solid skirt) | `:^A8` | [0.12, 0.19] | 0 | [0.50,0.50,0.56] | [0.60,0.58,0.70] / 0.10 | [0.007,0.007,0.011] | 1.3 / 1.2 | 0.45 | 5 / 2.4 |
| `hem` (torn strips, streamers) | `'^AA` | [0.11, 0.17] | 0.5 | [0.46,0.43,0.60] | [0.62,0.42,0.98] / 0.30 | [0.012,0.008,0.02] | 1.3 / 1.2 | 0.5 | 5 / 2.4 |
| `lining` (new: collar inside, lapel facings, optional inner skirt) | `.:^A` | [0.10, 0.14] | 0.5 | [0.22,0.20,0.55] | [0.30,0.27,0.55] / 0.3 | [0.012,0.010,0.035] | 0.8 / 0.6 | 0.35 | 4 / 2.2 |
| `shirt` (new, or reuse `pants`) | `:^AA` | [0.08, 0.12] | 0 | [0.40,0.42,0.50] | — | [0.006,0.006,0.010] | 1.0 / 0.8 | 0.38 | 5 / 2.2 |
| `pants` | `:!^A` | [0.11, 0.18] | 0 | [0.40,0.40,0.47] | [0.46,0.44,0.56] / 0.1 | [0.005,0.005,0.008] | 1.2 / 1.0 | 0.38 | 5 / 2.4 |
| `armor` plates (pauldron, vambrace, boots, knee guards) | `-=A8` | [0.11, 0.12] | 0 | [0.50,0.53,0.66] | [0.72,0.76,0.92] / 0.25 | [0.012,0.013,0.02] | 1.4 / 1.0 | 0.45 | 5 / 2.6 |
| `spike` (new: pauldron and knee points, vambrace barbs; +y toward the tip) | `'^AA` | [0.05, 0.06] | 0 | [0.62,0.66,0.84] | — | [0.012,0.013,0.02] | 1.4 / 1.0 | 0.5 | 5 / 2.6 |
| `trim` (silver bevels, buckles, rings, sole welt) | `-=#8` | [0.10, 0.08] | 0 | [0.80,0.84,1.00] | — | [0.025,0.027,0.032] | 1.2 / 0.7 | 0.6 | 5 / 2.6 |
| `leather` (belts, straps, grip) | `:=##` (grip: `:xX#`) | [0.09, 0.09] | 0 | [0.42,0.36,0.32] | — | [0.012,0.009,0.008] | 1.2 / 0.7 | 0.32 | 4 / 2.2 |
| `blade` | `'^AA` | [0.045, 0.09] | 0 | [0.45,0.95,1.35] | [0.80,1.20,1.70] / 0.3 | [0.02,0.03,0.05] | 1.4 / 0.8 | 0.9 | 3 / 2.6 (emissive [0.3,1.25,2.6]) |
| `gem` | `+*@@` (as today) | [0.03, 0.03] | 0 | [1.3,0.55,2.4] | — | [0.30,0.08,0.50] | 1.2 / 0.6 | 1.8 | 4 / 1.6 |

All glyphs above are in the world atlas (`npm test` checks this). `Λ`, `Δ` and `)`-style curved
carets from the panel map to `A`, `^` and `)`.

**Panel effects without a surface:**
- **Blade halo.** Spawn **6–10 `·` particles/s** within 0.06–0.12 m of each edge (alpha 0.5,
  colour `[0.10,0.35,0.60]` fading to `[0.02,0.08,0.20]`, life 0.4 s). Snap their positions to a
  0.06 m lattice in the blade plane so they form the panel's regular dot field. Add a 0.2–0.3 m
  dot streak past the tip as the "edge-wave", which is the visual reach.
- **Gem.** Keep `gemTick` and `gemGlint`. The gem must stay at least one cell (enlarge it to
  0.07 m in-game). The glow sprite (about 0.25 m, 12 px) is what the eye finds.

---

## 4. Key poses

### 4.1 How to read the tables
- **Lean** is the pelvis→neck line from vertical (+ = forward). **Twist** is the chest yaw relative
  to the hips (+ = toward the hero's left, the `spY` sign).
- **Knee** is the inner angle between thigh and shin (180° = straight).
- **Feet** are given as (x, z) relative to the root on the ground.
- **Sword** is a unit vector in body axes (x left, y up, z forward), like `swD`. "1H/2H" is one- or
  two-handed (`twoHand`).
- The hands are always: sword in the **right** hand, two-handed only in the heavy attack and the
  charge/thrust.
- Pose-frame times are where each sheet frame sits in the clip. Interpolate between them and let
  gameplay drive root travel, as the sheet footer says.
- The blade angle is set so the tip just reaches the ground. With concept steel (≈1.07 m from the
  hand) and the hand at 0.88 m the blade hangs about 55° below horizontal. With in-game steel
  (≈1.18 m) it hangs about 48°.

### 4.2 Idle: 2.4 s loop (frames at 0.0 / 0.4 / 0.8 / 1.2 / 1.6 / 2.0 s)
Base pose, held through all 6 frames:
- ¾ stance: right foot (−0.14, +0.10), left foot (+0.14, −0.04), so the **right foot is about
  0.12 m ahead**. Toes turn out 25–35°.
- Knees 170°. Weight sits on the left leg (hip shifted 0.03 m to the left). Lean +4°, twist +10°.
- The head turns 15–20° to the left and pitches 10–12° down.
- **Right hand** hangs at the right thigh (0.88 m, 0.05 m ahead of the hip). **Sword** about
  (+0.25, −0.80, +0.55), **1H**: down and forward across the front of the right leg, with the tip
  resting on the ground in front of the **left** boot toe, 0.35–0.5 m ahead. The flat faces the
  camera.
- **Left arm** hangs 10° away from the body with the fingerless hand loosely curled at 0.88 m.

| Frame | Change from the base |
|---|---|
| 01 (0.0) | neutral, start of the inhale |
| 02 (0.4) | chest up 0.004 m; sword tip 0.03 m further forward |
| 03 (0.8) | full inhale (chest +0.007 m, head lifts 3°); coat hem sways 0.03 m left |
| 04 (1.2) | exhale; sword swings 3° outward (tip 0.04 m to the right) |
| 05 (1.6) | hips sway 0.014 m left; tail tips flutter (±0.04 m, 1.2 s period); streamers ±10° |
| 06 (2.0) | returning to 01 |

The frames differ by ≤ 3° of sword angle and by coat flutter only, so treat the idle as breathing
plus breeze, with no weight change and no steps. **Coat:** rest flare plus breeze, back-left tails
most blown out.

*Superseded 2026-11-08:* the idle follows the owner's portrait, a wide contrapposto (anim.js
`guard`, §7.2): the straight right leg planted forward and out (−0.30, +0.20), the left foot out and
back (+0.27, −0.12) with its knee bent, the hips over the right leg, the torso leaning back toward
his left, the head turned left and tipped down, the free arm hanging straight. The sword is 1H, low
at the right hip, along (+0.76, −0.645, +0.17) (`IDLE_SW`, ~39° below level), its drawn point
resting 0–5 cm above the grass. (Round 1 had (+0.675, −0.737, +0.035), feet (−0.27, +0.20) /
(+0.12, −0.06).) A slow weight sway joins the breathing.

### 4.3 Walk: 0.9 s loop, side view (one frame per 0.15 s)
Held through the cycle:
- Lean +6°, head level (pitch −5°).
- **Right (sword) arm** trails about 20° behind vertical, elbow 165°. The hand is at 0.86 m, 0.18 m
  behind the hip.
- **Sword** (−0.08, −0.62, −0.78), **1H**: back and down about 38°, the tip 0.15 m above the ground
  about 1.1 m behind the hip. It barely moves (±3° counter-swing).
- **Left arm:** elbow 100°, fist 0.12 m ahead of the belt at about 1.0 m. It swings ±12° opposite
  the left leg.
- Hip bob ±0.02 m: low just after contact, high at passing.

| Frame | t (s) | Legs | Notes |
|---|---|---|---|
| 01 contact | 0.00 | left heel down 0.38 m ahead, right toe 0.38 m behind (stride 0.76 m); front knee 175°, rear 165° | hips −0.02 |
| 02 down | 0.15 | left foot flat, knee 155° (loading); right heel lifting | hips −0.03, lowest |
| 03 passing | 0.30 | right leg swings past with the foot 0.08 m up; left leg vertical, 175° | hips +0.01, highest |
| 04 contact | 0.45 | mirror of 01 (right heel ahead) | |
| 05 down | 0.60 | mirror of 02 | |
| 06 passing | 0.75 | mirror of 03 | |

**Coat:** the tails trail 15–20° behind vertical and the tips lag 0.1 s. **Streamers** stream back
almost horizontally at shoulder height, with a 0.05 m wave.

### 4.4 Sprint: 0.6 s loop (one frame per 0.1 s)
Held through the cycle:
- Lean **+28°**. The head pitches up 15° relative to the torso so the eyes look forward.
- Hips 0.06 m lower than standing. Stride about 1.5 m.
- **Right arm** is swept back about 45° at the shoulder, elbow 160°, hand at the hip height of
  0.95 m and 0.30 m behind.
- **Sword** (−0.12, −0.20, −0.97), **1H**: trailing back almost level (≈12° below horizontal).
  The flat faces up toward the camera. The sword stays level and bobs with the body (±0.04 m).
- **Left arm** pumps: elbow 85–95°, the fist travelling from chin height 0.30 m ahead to hip
  height 0.10 m behind.

| Frame | t | Legs |
|---|---|---|
| 01 contact | 0.0 | right foot planted just ahead of the hips (knee 150°); left leg extended back, toe off (160°) |
| 02 drive | 0.1 | left knee swings forward to hip height (thigh 80° from vertical, knee 70°); right leg extends back |
| 03 flight | 0.2 | both feet 0.12 m off the ground; front thigh horizontal; rear leg back at 45° |
| 04–06 | 0.3–0.5 | mirror of 01–03 |

**Coat:** the tails stream back **60–75° from vertical**, nearly horizontal, and the tips flutter
±0.05 m at 6–8 Hz. **Streamers** run horizontal at shoulder height, 0.6 m back. **Hair** is blown
back 20°.

### 4.5 Dodge: 0.55 s, a forward dive into a shoulder roll
The current roll lasts 0.60 s (`TUNE.roll.dur`). The sheet says 0.55 s. Changing it is a
gameplay-tuning decision (`COMBAT.md`), so match the poses first.

| Frame | t (s) | Body | Legs | Sword (body axes) | Left arm | Coat / FX |
|---|---|---|---|---|---|---|
| 01 crouch | 0.00 | hips at 0.62 m, lean 45°, head forward | knees: front (left) 80°, rear (right) 95° with the heel up | (−0.15, −0.35, −0.92), 1H, hand at the right hip at 0.75 m, tip about 0.3 m above the ground about 1.1 m behind | reaching down and forward, hand 0.25 m above the ground and 0.35 m ahead | tails flare back to 30°; dust at the feet |
| 02 launch | 0.08 | airborne 0.1–0.2 m, body about 65° from vertical (chest nearly horizontal) | front knee tucked to the chest (60°), rear leg extended back (150°) | (−0.10, −0.15, −0.98), trailing level | reaching forward and down | tails stream back and lift 20–30° above horizontal |
| 03 tuck | 0.18 | **balled**: head tucked between the arms, back rounded (≈90° spine flexion), body pitch ≈110°, hips at 0.55 m | knees to the chest | **along the body, forward**: (+0.05, −0.10, +0.99) in body axes, the hand under the chest, the blade low ahead of the ball 0.1–0.15 m off the ground | hugging in | the coat is **flung up over the back**, hem above the head |
| 04 roll | 0.28 | rolling over the right shoulder, pitch ≈200–240°, overall height ≈0.45 m | tucked over | the blade stays along the body's +Z, so as the body flips it lies **flat along the ground pointing world-back**, tip 0.1 m clear | tucked | the coat spreads behind as a dark fan about 1 m long |
| 05 kneel | 0.40 | upright, lean 15–20° | **right knee down** (0.05 m), right shin back; left foot planted 0.35 m ahead, knee 90° | (+0.10, −0.55, +0.83), forward-down, **tip touching the ground about 0.8 m ahead** | on the left knee or forward | back tails still lifted 30°; dust on landing |
| 06 recover | 0.55 | low guard, hips 0.75 m, lean 25° | left forward, knee 110°; right back, knee 140° | (−0.20, −0.55, −0.80), trailing back-down, tip near the ground 1.1 m behind | **fist raised forward at chest height** (1.2 m), elbow 80° | tails hang back and out 20° |

**Delta:** the current `rollPose` holds the blade out to the side and back,
`(−0.75, −0.2, −0.62)`. The sheet brings it in **along the body** for the tuck and roll, then
forward-down for the kneel.

*Built 2026-11-08:* frame 05 is a **sliding kneel**, not a still one: the gameplay root still moves
4–6 m/s there, so the right shin lies flat on the grass and slides, the left foot is planted with
the free hand braced on its knee, the torso is upright and the blade trails back-down with its point
dragging (dust, torn grass and sparks; `ROLL_SLIDE`). Frame 06 rises into the low guard with the
blade still behind, as the sheet shows. The sheet's forward-down kneel blade was dropped.

### 4.6 Light attack: 0.45 s, right→left sweep with a rising finish
Timing: `combat.js` light 1 has windup 0.14 + active 0.11 + recovery 0.22 = 0.47 s. In the sheet
the hero faces image-right and shows his right side.

| Frame | t (s) | Stance and torso | Sword (body axes) / hands | Left arm | Coat | FX |
|---|---|---|---|---|---|---|
| 01 ready | 0.00 | idle (§4.2) | idle low guard, 1H | relaxed | rest | — |
| 02 windup | 0.14 | feet 0.80 m apart along the line (left +0.35 ahead, right −0.35 behind), knees 140°/160°, hips −0.08; hips yaw −25°, **twist −35°** (right shoulder pulled back), lean 15°; head stays on the target | (−0.55, −0.25, −0.80): **back-right, 15° below horizontal**, hand at the right hip at 0.9 m, 0.25 m behind; 1H | across the chest at the sternum (1.25 m) | swings right and back | a faint cyan glint runs along the edge |
| 03 commit | 0.17 | hips square (yaw 0), twist −10°, front knee 130° | (−0.35, 0.0, +0.94): horizontal at **chest height 1.15 m**, sweeping through forward-right, flat up; 1H | pulls back to the left hip (counter-rotation) | begins to swing left | a cyan streak trails the edge |
| 04 strike | 0.22 | hips +25°, **twist +55°**, lunge 0.15 m (front knee 120°, rear leg extended) | (+0.85, +0.05, −0.50): swept round to **left-back at shoulder height** (1.3 m), right arm across the body; about 200° of sweep so far | out behind for balance | flung wide to the right (centrifugal), 35° flare | the **elliptical cyan arc** wraps the front of the body at 1.1–1.3 m, radius ≈1.5 m from the right shoulder |
| 05 follow-through | 0.32 | twist +90° (back ¾ to the camera), lean 10° | **rising**: (+0.55, +0.65, +0.50), hands at the left shoulder (1.45 m), blade up-left about 40° above horizontal | tucked to the chest | swinging back | the arc continues **up over the head** as a rising crescent and fades |
| 06 recover | 0.45 | back to idle | back to the low guard | relaxed | settles | — |

**Delta:** the current light 1 ends flat (`a2` 1.9, `elev` −0.04). The sheet finishes **rising**:
elevation +0.7 rad at the end of follow-through. The backhand (light 2) is not on the sheet, so
mirror this one.

*Built 2026-11-08:* from the low portrait guard the windup (02) cocks the blade **up over the right
shoulder** along one path paced by the steel point's travel (a vertical loop in 6 even frames, peak
78 m/s, under the strike's 98), instead of a 216° flick round the front at knee height. In the coil
the free hand reaches toward the target, then swings back hard against the sweep and stays out for
balance; the rear heel peels. Both sweeps snap into the rising finish and hold it ~4 frames before
going home. The active frames (03–04) are unchanged (ADR-024).

### 4.7 Charge attack: hold + release (thrust)
Current data: thrust windup 0.07, active 0.20, recovery 0.45. The hold length is driven by input.

| Frame | Phase | Stance and torso | Sword / hands | Coat | FX |
|---|---|---|---|---|---|
| 01 hold | first 0.25 s of the hold | **deep wide crouch**: feet 0.95 m apart (left +0.45, right −0.50), knees 95° front / 120° rear, hips at 0.70 m; lean 30°; twist −30°; head up, eyes on the target | **2H at the right hip** (0.80 m, 0.15 m behind the hip line, left hand above right); blade (−0.30, −0.55, −0.78): **back-down-right, tip about 0.1 m above the ground ≈1.0 m behind** | pools wide (30° flare); the front flap hangs between the knees | cyan wisps begin along the blade |
| 02 hold (charging) | while held | 0.04 m lower; blade 5° nearer the ground | as 01 | tails lift 10–15° (updraft); hair lifts | more cyan wisps on the blade and hands; violet motes from the gem |
| 03 charged | full charge, release start | as 02, a slight forward shift of weight | as 02 | tails whip back | **jagged cyan lightning strokes** (0.1–0.3 m) round the blade and hands, a dust ring at the feet |
| 04 lunge | release, active start (≈0.07–0.15 s) | **launch**: lean 60° (nearly horizontal), rear (right) leg straight back (175°), front (left) knee 100° with the foot about 0.2 m off the ground | **2H, both arms extended forward** at 1.1 m, blade (0, −0.03, 1) level | streams back horizontally | the **thrust streak** starts about 1.5 m behind the hips and runs through the blade to 0.5 m past the tip; dust kicked up behind the rear foot |
| 05 full extension | end of active (≈0.27 s) | **deep lunge**: feet 1.3 m apart, front thigh horizontal (knee 90°), rear leg straight, hips at 0.62 m, lean 40° | 2H, arms fully extended at 1.15 m, blade (0, 0, 1) | tails and front flap stream horizontally back | the cyan beam extends **0.6–0.9 m past the tip** and lingers behind as one line |
| 06 recover | recovery | back to idle | 1H low guard | settles | streak fades |

**Delta:**
- The current `chargeStance` draws the blade back level beside the chest, one-handed, with the free
  hand aiming forward. The sheet holds the blade **low, two-handed, pointing back-down at the
  ground**.
- The current `thrustPose` is one-handed with the free arm swung back. The sheet thrusts
  **two-handed, both arms extended**.

*Built 2026-11-08:* the hold winds tighter as the charge builds, and an updraft lifts the coat
panels, strips and hair (frame 02). The release dashes in **two bounding steps**: the rear foot
swings through and lands mid-dash, the front foot lifts for a 3-frame flight and lands into the
lunge; both are world-planted from touchdown (a dust puff each) and the stretched rear leg drags its
toe. The front foot no longer skids (1.02 → 0.08 m at full charge).

### 4.8 Heavy attack: 1.0 s overhead slam (combo finisher)
Timing from `combat.js`: windup 0.40, active 0.12, recovery 0.48.

| Frame | t (s) | Stance and torso | Sword / hands | Coat | FX |
|---|---|---|---|---|---|
| 01 ready | 0.00 | wide stance (feet 0.70 m), knees 150°, upright | **2H** low in front of the belt (0.95 m); blade (+0.10, −0.75, +0.65): down-forward, tip on the ground about 0.7 m ahead | rest flare | — |
| 02 windup | 0.20 | arches back 5°, head forward | hands rise past the right side of the head to 1.85 m, elbows high; blade (−0.20, +0.55, −0.80): **up-back about 33° above horizontal** | lifts | a cyan glint runs along the edge |
| 03 commit (apex) | 0.40 | stance widens to 0.85 m, knees 150°; **torso arched back 15°**, head tilted up 20° | hands **straight overhead** (2.0 m), arms vertical; blade (0, −0.60, −0.80): **hanging down behind the head and back** | tails hang wide | the fringe lifts off the eyes |
| 04 strike | ≈0.46–0.52 | torso folds forward 45°, hips drop 0.15 m, front knee 110° | hands swept down to knee height (0.6 m) in front; blade (0, −0.95, +0.30), tip into the ground 0.9 m ahead | flung forward, then back | a **tall vertical cyan arc** (two parallel crescent streaks, ≈0.25 m wide) from about 2.3 m above the head down to the impact; impact flash |
| 05 follow-through | 0.60 | crouched over the planted blade, hips at 0.70 m, lean 50°, head down | 2H on the hilt; blade stuck about 0.08 m into the ground | pools wide (30°) | **crystal shard burst** and rock debris (§4.9) |
| 06 recover | 1.00 | rises to the idle stance | back to the 1H low guard | settles | shards fade |

**Delta:** the current slam coil `a0` is 2.55 rad (blade up-back). The sheet's apex is deeper:
**the blade hangs down the back**, about 3.7–3.8 rad of elevation (`atan2(y, z)` of (0, −0.6, −0.8)). The hands stay overhead, so the
coil comes from the wrists and arms rather than from more hand travel. The rest matches
`slamPose`.

*Built 2026-11-08:* the windup (02) first **gathers** (a dip, a coil to the right, both hands
drawing the blade down and back past the right hip), then **raises** it up the right side past the
head and over the top into the unchanged apex, so it stays visible from behind (a straight raise up
the middle hid it behind the head for ~0.2 s). On impact the body sinks 5 cm, the head bows and the
blast throws the coat tails out.

### 4.9 FX per frame (cyan language)
Colours are the current `fx.js` `COL` values unless noted. Every glyph is in the atlas.

| Effect | When | Shape and size | Glyphs | Colour | Life |
|---|---|---|---|---|---|
| **Sweep arc** (light) | light 03–05 | An elliptical band at the outer 35 % of the blade, at 1.1–1.3 m height, radius ≈1.5 m. It covers **190–270°** of sweep and rises about 10° toward its end (the 05 crescent goes over the head). The leading edge is 1 cell; the trailing halftone is 3–6 cells (0.3–0.6 m). | leading edge `A 8` (`trailCore`); body `)` `|` laid along the motion (today's `|` stretch is right); tail `+` then `·` on a **regular 0.12 m lattice** in the arc plane | edge `[1.1,2.1,3.1]`, body `[0.4,1.25,2.3]` → `[0.02,0.14,0.45]` | edge 0.12 s, halftone 0.25–0.35 s (longer than today, so the dot field reads) |
| **Thrust streak** (charge 04–05) | release | A straight beam along the line, from about 1.5 m behind the hips to 0.6–0.9 m past the tip (≈3.5 m in all). A 0.03 m white-cyan core with a 0.10 m glow, plus sparkle motes. | core `-` / `=` stretched along the line; halo `·` | core `[1.1,2.1,3.1]`, glow `[0.4,1.25,2.3]` | 0.25 s, linger 0.35 s |
| **Charge gather** (charge 02–03) | while held | Short jagged strokes 0.1–0.3 m crawling along the blade and round the hands; violet motes rising from the gem; at full charge a dust ring 1.2 m across | `/ \ ^ '` (lightning); `·` (motes); `. , :` (dust) | `charge [0.7,1.7,3.0]`; gem violet | 0.1–0.2 s each, continuous |
| **Slam arc** (heavy 04) | strike | A vertical crescent from about 2.3 m down to the impact point, about 0.25 m wide, drawn as **two parallel streaks** | as the sweep arc, denser (`TRAIL_ALONG_HEAVY`) | `trailHeavy [0.55,1.6,2.9]` | 0.2 s |
| **Crystal shards** (heavy 04–05) | impact | **10–14 kite / diamond shards**, 0.08–0.35 m long, fanned up and out across **160°**, mostly in the plane facing the camera, rising 0.5–1.2 m. A cyan ground flash ring about 1.2 m across. | `A ^ V / \` (kites) | `shard [0.9,1.9,4.2]` → `[0.1,0.25,1.0]` | 0.4–0.6 s, falling with gravity |
| **Rock debris** (heavy 05) | impact | 6–10 dark chunks, 0.05–0.12 m, thrown 0.3–0.8 m | `# % &` | `[0.2,0.18,0.14]` (dust tones) | 0.5 s |
| **Gem glint** | windup start of each attack; idle every 1.8 s | A 4-point star with a white core | `+` rotated 45°, `°` | `gemCore` → `gem` | 0.18–0.28 s |
| **Dodge dust** | dodge 01, 05 | a small ground puff | `. , :` | dust | 0.45–0.85 s |
| **Blade halo** | always (dimmer at idle) | `·` dot lattice ±0.12 m around the edges plus 0.2–0.3 m past the tip (§3.2) | `·` | `[0.10,0.35,0.60]` | 0.4 s |

*Built 2026-11-08:* the sweep arc sub-steps by the outer point's travel and curves round the hilt,
so at the game camera it is one continuous crescent (it was scattered dashes); the halo and the tip
streak sit on the drawn point; new **roll skid** (dust and torn-grass bits `. , : / \ '` off the
sliding shin and foot, `COL.grassBit`) and **point scrape** (cold `' |` sparks); the thrust dash's
footfalls kick dust.

---

## 5. Build checklist (priority order)

There are 15 traits. **(a)** is the rank for a side-view close-up (showroom, Lab, cut-ins). **(b)**
is the rank at the in-game top-down camera, where about 45 px of height is available and
horizontal spreads read best.

| # | Trait | (a) | (b) | Construction suggestion |
|---|---|---|---|---|
| 1 | **Light-grey `A`-glyph figure on black gaps; neutral hue, violet only at the gem and hair sheen** | 2 | **1** | Apply the §3.2 table: `A`-family ramps, `flip: true` on `orient.down` limbs so the carets stand up, `rowShift` 0 on body parts, coat violet `altChance` about 0.1, outline ≤ 1.3. Check that no part of the body reads lavender in the screenshots. |
| 2 | **Long sword in the RIGHT hand, held low with the point down at the ground ahead; cyan edges; violet gem at the hilt** | 3 | **2** | Steel 1.30–1.40 m total, blade 0.09–0.10 m wide, with an 0.2–0.3 m `·` glow past the tip and the 1.5 m hit segment kept. Ramp `'^AA` in 2 columns with edge and ridge seams. Enlarge the gem to 0.07 m and keep the glow sprite. In idle the tip touches the ground in front of the left toe. |
| 3 | **Long open coat flaring into an A-line of 20–22 long jagged tatters** (mid-calf hem, tips to 0.12 m) | **1** | 3 | Anchor the skirt at 1.12 m under the belts. Six panels with the §2.4 lengths (solid parts to 0.60 m in front, 0.50 m at the sides and 0.40 m at the back; strips 0.15–0.38 m long). Rest flare 14–18° plus breeze, 1 strip in 4 forked, 2–4 holes per panel. Give each strip its own sway, as a third spring segment or a per-strip vertex-shader sway keyed by strip id. |
| 4 | **Messy black mop with a heavy fringe falling over the eyes**; no upward crown spikes | 4 | 5 | Replace the 16-spike crown star. A scalp cap 1.18 × 1.08 × 1.15 the skull, 7 fringe clumps (0.07–0.12 m, down 70°), a long left side lock to the jaw, short right locks with the ear exposed, 6–8 crown flicks of 0.03–0.06 m, 4–6 side flicks per side, and 5–7 nape locks to the collar (§2.1). Keep the spring clusters (fringe / left / right / crown, plus nape). |
| 5 | **Spiked pauldron on the RIGHT shoulder only**: 3 upswept blades to ear level plus a front fang | 5 | **4** | 4 lames (§2.7) with silver bevels in `trim`. Make 7 points with `spike()`: S1–S3 up and out at 0.08–0.12 m (tips at 1.62–1.64 m), S4 out, S5 a 0.10 m down-pointing fang over the chest, S6–S7 down-back. Point the S2 and S3 tips outward so the star reads from above. Put strap C1 across the chest. |
| 6 | **Tall flared stand collar up to the jaw, open in a V; the neck never shows** | 6 | 9 | `collarGeometry` from 1.41 to 1.62 m, r0 0.075 → r1 0.112, `open` ≈0.75 rad, front corners raised to 1.63 m, inner face in the `lining` material. The hair cap must meet the collar top at the back. |
| 7 | **Anime proportions**: 7.8 heads, small head (0.20 m chin→crown), legs 49 % of H, V-taper 0.44 → 0.27 m | 7 | 10 | Head: skull ellipsoid radii (0.078, 0.10, 0.09) centred +0.165 above the head joint, jaw (0.052, 0.045, 0.056) at +0.09, so the chin lands at about 1.57 m. Torso: **one lofted V-shell** from the hips (0.32 W) through the waist (0.27) to the chest (0.36), replacing the 3 stacked ellipsoids. Shoulder joints ±0.17. The legs are already right (hip joint 0.89–0.92 m). |
| 8 | **Belt stack at the natural waist with silver buckles**, the bright band separating torso and skirt | 8 | 8 | Belts W1 (1.21 m) and W2 (1.17 → 1.13 m), diagonal strap H1 (1.13 → 0.95 m), drop straps D1 and D2, and `trim` buckles (§2.6). Put the belts on the spine joint, not at 1.0 m. |
| 9 | **Sleeve streamers**: torn strips trailing from the right upper arm (0.45–0.6 m) and the left elbow (0.35 m) | 10 | **6** | Two 2-segment spring strips in the `hem` material, rooted on `arms.R.upper` (under P4) and `arms.L.fore` (at the elbow). Rest: hanging down and out 20°. Walk and sprint: streaming back horizontally. These, with the coat, are the main **motion lines** read from above. |
| 10 | **Cyan FX language**: elliptical sweep arc, straight thrust beam, vertical slam arc plus crystal shards | 15 | **7** | §4.9. Lengthen the halftone tails to 0.25–0.35 s on a regular lattice, use `A 8` on the leading edge, `)` and `|` in the body, `+` and `·` in the tail. |
| 11 | **Open coat front**: lapels, black shirt with a button column, grey-violet piping on the front edges | 9 | 13 | Build the torso shell with an open front gap (0.08 m at the sternum, 0.17 m at the belt), lapel flaps folded out, a shirt panel in the gap (`shirt` ramp), and the front-edge piping as a thin `trim` strip. |
| 12 | **Torn-edge colour**: black coat → grey-lavender torn zone with darker blotches; indigo lining inside the flare | 12 | 11 | `hem` ink `[0.46,0.43,0.60]` with violet `altChance` 0.3 only on strips. Optional inner skirt in `BackSide` + `lining`; at minimum, line the collar and lapels. |
| 13 | **Knee-high armoured boots with pointed knee guards** | 11 | 14 | 3 shin lames and 2 instep lames in `armor`, a bright sole welt in `trim`, and kite poleyns whose spike tips sit at 0.60 m and lean 15° outward (`spike` material). |
| 14 | **Asymmetric arms**: plate vambrace and gauntlet on the right, leather bracer and fingerless glove with a silver cuff on the left | 13 | 15 | Right: 3 lames, an elbow point and a wrist barb. Left: a bracer with 2 bands and a `trim` cuff ring. Show the left fingertips as 1 `skin` cell. |
| 15 | **Pose language from the sheets**: low point-down guard, trailing blade in locomotion, 2H for charge, thrust and slam, rising light finish, forward dive-roll | 14 | 12 | §4 deltas: `chargeStance` low and 2H, `thrustPose` 2H, light `a2`/`elev` rising, roll blade along the body, deeper slam apex, dodge 0.55 s (needs a tuning decision). |

**Top-down sanity check:** at about 48 px/m the hair disc is about 11 px, the shoulders 21 px,
the pauldron star adds 6 px on one side, the coat hem is 34–43 px wide, and the sword reaches
55–70 px. **The sword, the coat fan and the pauldron star are the silhouette.** The hair and
collar sit on top of it, and the belt band and gem are its bright points. If a change does not
show at that scale, it belongs in a close-up only.

---

## 6. Open questions for the owner / lead
1. **Sword length.** The painted steel (1.30 m total) and the ASCII panel's long glowing blade
   disagree. This spec proposes 1.30–1.40 m of steel plus 0.2–0.3 m of glow, and keeps the 1.5 m
   hit segment.
2. **Dodge duration.** The sheet says 0.55 s; the game has 0.60 s. A shorter roll changes the
   i-frames and `COMBAT.md`.
3. **Glyph scale.** The panel's 30-row figure is impossible at the default camera, where ≥ 6 px per
   glyph allows 10–14 rows. A closer hero camera, or a showroom/cut-in camera, would show more
   detail.
4. **Combo layout.** The sheet shows one light attack. Light 2 (the backhand) mirrors it, and the
   heavy slam stays the combo's 3rd hit (DEVLOG 3b).

---

## 7. Implementation notes (rebuild, 2026-11)

What `src/entities/player/model.js`, `anim.js`, `fx.js` and `combat.js` now do, and where they
depart from this spec.

**Proportions.** Joints are unchanged except the shoulders (±0.17) and the head joint (+0.31 above
the chest, 1.535 m). The idle stands 0.015 m above `DIM.pivot` (knees ≈165°), so the skull centre
sits at 1.675 m (radii 0.078 / 0.10 / 0.09), the chin at ≈1.57 m and the crown at ≈1.78 m.
`DIM.skull` holds the skull offset; the hair and the face are built around it.

**Torso.** One lofted shell (`shellGeometry`: rings from the hips 0.30 W through the waist 0.27 at
1.21 m and the chest 0.37 to the shoulders) on the spine joint, open at the front (0.08 m at the
sternum, 0.17 m at the belt). A black shirt panel with 7 silver buttons fills the gap; narrow lapels
in the `facing` material; a dark spearhead emblem on the back. aGUV x = angle × 0.15, so the glyph
columns line up down the body. The yoke seam, princess seams and piping lines are not modelled
(sub-pixel in game).

**Collar.** `collarGeometry`: 1.47 → 1.61 m behind, front corners at 1.635 m, r 0.078 → 0.108, a V
0.024 → 0.084 m wide. Outside in its own fine-grid `collar` material (cells 0.06 × 0.075: at the
coat's 0.19 m cells the band held one huge glyph), inside the indigo `lining` (BackSide).

**Hair.** A scalp cap with the face cut out (the hairline runs from +0.03 m at the front to −0.07 m
behind), then 5 spring clusters: fringe (7 flattened clumps hanging ~75° down plus one strand over
the right eye), left (the long lock to the jaw plus flicks), right (swept back, so the ear shows),
crown (8 flicks ≤ 0.045 m, swept back: no star), nape (6 locks down to the collar). Clumps carry +y
toward their tips, so the fringe reads as a jagged row of points over the eyes. Known gap: from the
front the fringe still reads a little like a comb standing off the face; in game it is one row of
cells.

**Coat skirt.** `COAT_PANELS`: six panels plus the front flap, anchored at 1.12 m (`DIM.coatY`
0.165). Each panel is two solid spring segments (sheets whose curvature radius grows with depth, so
neighbours form a cone; coat outside, `lining` inside) and 3–4 torn strips (`tatterStrip`: notched
edges, a claw curl, 1 in 4 forked). That is **22 strips, each on its own spring** (`_strips`:
gravity + an outward flare − the panel's velocity, its own flutter, and a ground check). Rest flare
16° (`COAT_FLARE` 0.3) with an idle breeze (back-left blows out the most). Velocity drag is
`lag × (1 + 0.18 |v|)`: ≈40° behind vertical at the 4.6 m/s run and ≈60° at the 7.2 m/s sprint (the
sheet's walk is slower than the game's run). Burn holes are not modelled.

**Belts and straps.** W1 (1.21 m) and W2 (1.17 → 1.13 m) leather rings with silver buckles and
rivets on the spine; H1 (left hip → right thigh, tilted 0.55 rad) with its buckle, and D1 with a
D-ring and a metal tip, on the pelvis; D2 and its ring on the right thigh; C1 from the right
collarbone to the left ribs (a tilted ring, so it also crosses the back); the A1 / A2 arm straps; the
knee-guard straps.

**Pauldron (right only).** P1 / P2 domes on the pauldron joint (it follows the arm 35 %), P3 / P4 arc
plates on the upper arm itself (they follow it fully), a silver bevel under every plate, S1–S3 as
flattened upswept blades (S2 / S3 angled out for the top-down star), S4 pointing out, the S5 fang over
the chest, S6 / S7 down-back. The left shoulder is plain coat.

**Arms.** Right: the sleeve, 3 vambrace lames with bevels, an elbow point, a wrist barb and a
gauntlet. Left: the sleeve, a leather bracer with 2 silver bands, a silver cuff, and a fingerless
glove with a skin fingertip patch. **Streamers**: two-segment springs (`_streamers`) from the back
of the right upper arm (0.54 m) and the left elbow (0.35 m). They hang out ~20° at rest and stream
back nearly level when running.

**Legs.** Pants taper 0.15 → 0.11. Boots: a shell, 3 shin arc lames with bevels, instep lames, a heel
and a silver sole welt. Kite knee guards with the top point leaning 15° out, a spike tip and side
wings.

**Sword.** 1.36 m of steel (pommel tip −0.19 → point `DIM.steelTip` 1.17), the blade 0.095 → 0.08
wide with a 14 % tip taper. Upswept quillons (span ≈0.25) with inner hooks, cage rails with 3 barbs a
side, a silver diamond frame around a 0.07 m violet gem proud of both flats, a kite pommel with a
collar, and ferrules. The hit segment is unchanged (`bladeBase` 0.16 → `bladeTip` 1.5, plus
`REACH.tipExt` 0.4); the tip's ground clamp uses the steel length. (*2026-11-08:* drawn to 1.64 m,
`DIM.drawnTip` 1.45, with 6 teeth a side growing toward the point and a ridge line; the forte is
0.25, so the cyan starts under the gem; §7.2.) The blade material uses `levels`
chevrons (2 columns, +y toward the tip) and `seamAxis: 'y'`, so only the edges and the ridge carry
the cyan seam lines (no ladder). player.js keeps the flats dark at idle (uInkGlow 0.5) and flares
them through strikes.

**Materials (§3.2 as built).** (*Since 2026-11-08 these only shape the `uArtSolid` = 0 render; in
game the hero is ink-line art, §7.2.*) Every large surface uses `levels` (whole glyphs, picked per cell from
the cell-centre light) with the caret family at every level, dense `8` only on the lit levels (about
1 in 7), no bar glyphs and no lone dots (polka dots). Departures from the §3.2 table, all found in
the browser:
- `lumScale` 3.5 and `gain` 1.4–1.8, not 5 / 2.4–2.6: at 5 every moonlit cell hit the top level and
  the bloom turned the figure white.
- `outline` 0.15–0.45 and `rim` 0.15–0.4, not 1.0–1.4: even 1.1 still read as a neon outline in
  close-ups, and the game-camera read does not need it.
- `inkGlow` ≈0.2–0.3 on cloth, with the shadow levels still carets, so the back stays a dim field of
  glyphs instead of going black.
- The inks lean slightly warm (r > b) because the moonlight is cold (B/R ≈ 1.7). Measured B/R of the
  lit pixels is 1.15–1.28 in the dark close-ups (target ≤ 1.15); the remaining blue is the moonlight
  itself.
- Skin is `levels` of `' . : o` at 0.04 m, dim and warm, so the face is a sliver of light, not a pair
  of eyes.

**Poses (§4).** (*The idle, the light windup, the slam windup, the thrust dash and the roll's kneel
are superseded by §7.2.*) `guard` (idle: right foot ahead, weight left, head turned and tipped down, the sword
1H at the thigh with the point on the grass ahead of the left boot); `loco` (run: blade back-down
38°; sprint: lean ≈28°, blade level behind, fist pumping); `slashH` (the coil at the right hip, twist
−35° → +55°, a rising finish through `elev2` in the attack data); `slamPose` (the windup goes ready →
raise → blade hanging down the back at the apex, `a0` 3.75 rad through the wrists, the torso arched
and the head up, then a 45° fold over the impact); `chargeStance` (deep wide crouch, **2H** at the
right hip, blade back-down); `thrustPose` (the windup whips the blade onto the line, then a 60° → 40°
lunge with **both arms extended**); `rollPose` (keyed to the six sheet frames on the 0.6 s roll:
crouch, launch, ball, over the shoulder with the blade flat along the ground behind, a right-knee
kneel with the point on the grass, a low guard; the blade path is keyed in root axes and converted
through the body pitch). Timings and damage are unchanged; the dodge stays 0.6 s.

**FX (§4.9).** Sweep arc: an `A` / `8` leading edge, `)` / `|` strokes along the motion, and a `+` /
`·` halftone tail snapped to a 0.12 m world lattice (0.25–0.35 s). Thrust: a `-` / `=` core laid
along the line with a `·` halo (thin and straight). Charge: motes, then jagged `/ \ ^` strokes past
half charge, and a dust ring at full charge. Slam: 12 kite shards fanned across ~160° in the camera
plane, standing crystals, rock debris and a ground ring. Blade halo: `·` dots on a 0.06 m lattice
beside both edges and 0.02–0.3 m past the point, always on (dim at idle). Idle gem glints only fire
while the hilt is steady.

**Cost.** 112 meshes after merging (125 before), ≈14.5k triangles, and the animator takes ≈0.2 ms per
update in the browser. The `npm test` scenario `hero` drives a run, a sprint, a roll, the light combo
with the slam and a charged thrust, and checks that every rig matrix stays finite, no strip tip goes
under the grass and the steel point never sinks into the ground.

**Not done / open.** Burn holes in the panels, the yoke / princess seams, the argyle lining pattern,
finger plates on the gauntlet, the fringe lifting at the slam apex, and the idle sword's ±3°
breathing beyond the sway. (The glyph-scale gap of the first build is closed by fix round 1 below.)

### 7.1 Fix round 1 (art-director review: hero 4/10 → this round)

Each P0 / P1 gap of the review, and what was built for it. (*Since 2026-11-08 the glyph cells, inks
and glyph zooms below only show in the `uArtSolid` = 0 render. The geometry still stands except
where §7.2 changes it, and the blade's distance self-lighting (`bladeFar`) still feeds the ink-line
fill.*)

- **Glyph scale (P0).** `setHeroGlyphScale(mats, dist)` (model.js) runs every frame from
  `Player._updateMaterials` with the camera → hero distance: k = clamp(dist / 12, 0.15, 1), so the
  cells are the in-game size at the 36 m camera (and anywhere past 12 m) and shrink in close-ups:
  the coat's 0.12 × 0.19 m cell becomes 0.04 × 0.063 m at 4 m (≈30 rows, the panel's field) and
  ≈0.018 × 0.03 at 1.8 m. Small parts are capped at any distance (hair 0.045 × 0.055, collar
  0.04 × 0.05, plates 0.05 × 0.06, spikes 0.04 × 0.05), so a curved part never holds one giant glyph
  cut into stripes. Up close the cloth / plate glyphs also sit smaller in their cells (glyph zoom
  0.62 → 0.85–1.0), which gives the panel's thin glyphs on black instead of "AAAA" wallpaper. The
  blade keeps its two columns (width locked); the gem, eye and face keep fixed cells.
- **Hair (P0).** A wider scalp cap (0.104 × 0.112 × 0.114) rooted with `capPoint`, and every clump is
  now a flattened tapered lock (`clumpGeometry`: width along X, thickness along the curl, so the
  fringe is wide side to side, not a fin jutting forward). Fringe: 7 locks, root half-width
  0.017–0.019, 0.09–0.12 m long, ~72° down, tips curling back toward the face and ending ≈0.02 m in
  front of it, plus one strand over the right eye. The mop: 13 broad locks rooted round the crown
  whorl and 10 more at mid-height lie down over the scalp and lift 3–5 cm off it at their ends, so
  the dome is hidden and the outline is a jagged ring of lock tips 0.04–0.06 m outside the cap; 7
  shorter temple flicks stick out sideways and back; 3 short near-vertical crown flicks (≤ 0.045 m)
  and 4 swept-back cowlicks; 6 nape locks. Each lock is split at 60 % of its length: the roots use
  `hair` (ink ≈[0.22,0.22,0.3], no sheen), the outer 40 % uses `hairTip` (violet alt ink
  [0.55,0.42,0.95] on 45 % of its cells), so the sheen sits on the strand ends only.
- **Gem (P0).** The forte under the cage (z 0.125 → `DIM.forte` 0.35) is now dark gunmetal (`armor`)
  between silver rails (`trim`), and the glyph blade starts above it. The gem is two half-gems at
  y = ±0.016, each proud of its flat by 0.018 m, inside a silver frame. Gem ink [0.55,0.12,1.3],
  base [0.22,0.04,0.5], emissive [0.9,0.2,2.2], ink glow 0.45 + 0.4 × the pulse (saturated violet,
  not blown to white). `gemTick` keeps an always-on violet glow sprite (0.22–0.26 m, [0.6,0.15,1.4])
  at the gem: a 3–4 px violet point at the game camera.
- **Game-camera read (P0).** The blade self-lights with distance (`player.bladeFar`, 0 below 10 m →
  1 at 28 m): the flats' ink glow 0.16 → 2.46, glyph zoom 0.72 → 0.46 (the chevrons fill their
  cells) and the gaps' base lifts to [0.35,0.7,1.1], so at 36 m the sword is a solid bright cyan line
  with bloom, the brightest thing on the hero; up close it stays dark steel with glowing edges and
  ridge (seam glow `uGlow` 1.0 at idle, twice the old value). The `·` halo runs at 9–10 dots/s,
  alpha ≥ 0.6, dots growing ×2.2 with distance, plus a bright `|` streak 0.06–0.26 m past the
  point. Cloth stays under the bloom threshold (lit glyph lum ≈0.32–0.36 at the game camera).
- **Pauldron (P1).** P1 is a shallow open dome shell, P2 a flat band wrapping the deltoid from front
  to back (0.086 → 0.1 m: 0.03–0.045 m off the sleeve), P3 / P4 arc lames 0.03 m off the arm; every
  lame has a 0.011 m `bevel` strip proud of its lower edge. The needles are replaced by flattened
  wedges (`clumpGeometry`, 0.012 m thick, curving back): S1 0.09 × 0.05, S2 0.165 × 0.066 tilted 45°
  out, S3 0.12 × 0.058 out-up, the fang S5 0.10 × 0.058 down over the chest, and two small wedges on
  P3 / P4. S4 is gone. Spike outline / rim 0.15.
- **Collar (P1).** 1.505 → 1.61 m behind, front corners 1.635; r 0.078 → 0.12 at the sides (0.096
  deep) with a 0.015 m roll; the V opens from 0.028 m at the base to 0.156 m at the top, so the chin
  and jaw show. Outside `collar` (cloth ink, cells ≤ 0.04 × 0.05); inside `collarIn` (ink
  [0.3,0.27,0.55], base [0.03,0.025,0.08], self-lit enough to read blue-violet unlit).
- **Face (P1).** Skin ink [0.78,0.72,0.7] on a warm base, fixed 0.016 m cells of dense `:o` / `o0`
  glyphs with ink glow 0.44: the face is the lightest area of the head even in moon shadow. A
  grey-violet `-` cell marks the visible left eye.
- **Hem / tatters, cloth bloom and shadow sides (P1).** Hem ink ≈[0.35,0.33,0.34] with 18 % violet
  alt cells, ink glow 0.15, glow mask 0 (no neon trim). Strip roots ≥ 0.065 m. Cloth (coat, collar,
  pants, shirt) ink ≈0.25–0.42, slightly warm (r/b ≈ 1.2 against the cold moon), gain 0.85–0.95,
  ink glow 0.13–0.15, and every ramp's darkest level is still carets (`'` / `^`), so shadow sides
  print a dim caret field instead of black tubes.
- **Belts (P1).** W1 / W2 / H1 / C1 are flat leather bands (`bandGeometry`) 0.048 / 0.04 / 0.034 /
  0.035 m wide standing ≈0.012 m off the coat, leather ink [0.42,0.36,0.32] with stitched `: =`
  levels; buckles 0.05 × 0.04 in `trim` (silver [0.8,0.84,1.0]).
- **Knees and boots (P1).** Kite poleyns rebuilt as a faceted plate 0.10 W × 0.13 H with a raised
  ridge, standing 0.02 m off the knee, `bevel` strips on all four edges and the ridge, wings, and a
  wedge point to 0.60 m, all leaning 15° out. Shin lames carry `bevel` lower edges; the sole welt
  moved to a quiet `welt` material (ink glow 0.18, no bloom).
- **Blade surface (P1).** Flats ink [0.18,0.3,0.5] (dark steel) with sparse chevrons; the glow lives
  on the edge and ridge seams. The last 0.15 m (`bladeTip`) is the brightest steel. Both columns
  point to the tip.
- **P2.** Lapel facings darkened to lining ink, with 8 mm grey-violet `piping` strips along the lapel
  edges and down both front edges of the coat; the shirt has its own finer grid. Vambrace lames carry
  bevel bands, an elbow wedge (0.065 m), a wrist barb and a trim cuff; the left bracer has bevel
  bands and a 0.025 m trim cuff. Streamers 0.075 / 0.068 m wide. The back panels rest at ≈10° flare
  (`flare: 0.18`; the sides keep 16° plus the breeze) and every panel top is tucked just inside the
  coat shell under the belts (`DIM.coatY` 0.18, an elliptical anchor ring), so there is no lampshade
  rim. Gem glints and motes move with the gem's own velocity and live ≤ 0.16 s; the full-charge glint
  is smaller. The idle steel point rests on the ground (`TIP_FLOOR` 0.012). Light-attack stance
  0.82 m with a 15° lean; at the slam apex the knees stay bent so the stance holds 0.85–0.9 m
  (measured in the browser: the blade at the apex points (0.02, −0.67, −0.75); the sheet has
  (0, −0.6, −0.8)).

**Still open after round 1.** The light sweep's arc ease stays smoothstep: a faster start (40 % of
the arc by 0.17 s, the sheet's commit frame) broke the 3–3.5 m REACH tests, so at 0.17 s the blade
is still at the right side. Body lit-pixel B/R is ≈1.18–1.25 at the game camera (target ≤ 1.15; the
moon itself is B/R 1.7 and the final grade cools dark pixels). The light finish rises up-left-back,
not up-left-forward. The pauldron star reads in close-ups and from above but is only a few pixels at
36 m.

**Integration check (verifier).** At the boss camera (36 m, lock-on, the hero 9 m in front of the
wyrm, seen from behind facing it) the figure is ~26 px tall and the blade hides behind the body;
with the cloth / plate glyphs at zoom 0.62 their strokes went sub-pixel and the hero printed as a
dark cone no brighter than the glyph stones around it (hero region mean luminance 40 vs 35 for
the grass). The game-camera glyph zoom is now `GLYPH_SCALE.farZoom` 0.45 (model.js): every glyph
fills its ~5 px cell, so the hero reads as the panel's light-grey caret field (mean 63, p75 105).
Ink colours and the bloom threshold are unchanged (more lit pixels, not brighter ones); close-ups
keep `zoomNear` (a 4 m Lab close-up moves 0.92 → 0.88).

### 7.2 Reference match (2026-11-08): ink-line art and motion

The owner attached the "Shadow Swordsman" ASCII line-art image (anime line art turned into ASCII:
a dim, dense letter fill inside bright ink strokes) and asked for the hero to look "as identical and
good as" it, with great animation and movement. Two rounds of a look agent and a motion agent:
round 1 each had an independent reviewer / polish pass; in round 2 both hero builds finished and
reported with tests passing, but their review passes were stopped mid-way and the unfinished edits
were discarded (kept outside the repo as `scratchpad/look/hero-look-polish-unfinished.patch`).
Supersedes the notes above where they disagree. Decisions: ADR-019 … ADR-024. Contracts:
ARCHITECTURE.md "Creature ASCII art" and "Player".

**Rendering.**
- **Ink-line art** (round 1): every material writes a part id (`HERO_INK` → `heroArt`); the pass
  draws bright lines on the silhouette, on the nearer side of depth steps and on part edges (the
  higher part draws), over dim fill letters. Part ids (layered parts get higher ids): skin 1, eye 2,
  shirt 3, lining / collar inside 4, pants 5, coat / collar 6, lapel facing 7, hem (torn zone,
  strips, streamers) 8, piping 9, leather 10, hair 11, armour 12, spikes 13, bevels 14, welt 15,
  trim 16, blade 17, gem 18, flask 19. Sub-ids (`aPart`) alternate on neighbouring coat panels, hair
  locks and the blade's two halves, so they are outlined up close.
- **Lines traced per pixel** (round 2, ADR-020): one font pixel wide plus a dimmer second pixel up
  close, a gap at each letter spacing (a chain of stroke glyphs); dotted on the tails and hair,
  unbroken on the blade and gem. Fill cells that an edge crosses print a dim letter up close (the
  dark channel); the face is `open`.
- **Source light** (round 2): `U.uArtHeroLight` (0.2, 0.95, 0.2, 1.4) = less flat light, more key
  light from the camera's upper left, stronger glints on curved metal; `U.uArtHeroRim` (0.14, 0.19,
  0.72) on the screen's left; `uArtBlack.x` 0.06, `uHeroFill` (0.03, 0.6, 0.27, 1); the coat's fill
  carries fold streaks up close (`folds` [34, 0.85, 1.1]).
- **Game camera** (round 1 LOD, round 2 dark figure, ADR-021): one-letter outline at every distance;
  between 6 and 20 m view depth piece edges drop out (dithered), cloth inner lines become dark
  seams (`farLine` 0), armour keeps bright edges (`farLine` 0.55–0.7), the fill takes `farFill`
  (cloth 0.35, hem 0.4, hair 0.5, armour 1.05–1.2, blade 2) × `uHeroLod.z` 1.3, the silhouette is a
  dim cool rim (`uHeroLod.w` 0.25), the letters come from a dense far ramp, and the blade and gem
  glow is capped (HDR 1.8). A dark halo darkens the world grid round him from 8 m, fully at 20 m.
- **Blade** (round 2, ADR-022): drawn to `DIM.drawnTip` 1.45 (1.64 m of steel); at the game camera
  the blade, point and gem are drawn up to 0.65 m nearer the camera (`BLADE_PULL`), so the low guard
  reads as a full cyan line across his back from behind.

**Model** (`model.js`).
- Round 1: a wide coat flare through the per-panel `flare` with longer, wider strips (still 22); a
  bigger layered pauldron with 6 claw blades; a fuller hair mop (polish: near-neutral dark fill with
  violet tips, no bars over the face); saw teeth along the blade and claws on the guard; the left
  eye a larger dark almond with a violet lid line, its two fringe locks shorter.
- Round 2: the blade as above, built as two halves (a centre ridge line), the forte 0.35 → 0.25 (the
  cyan starts under the gem), 6 teeth a side growing toward the point, shorter cage rails. Coat
  panels wider (hems 0.3 front, 0.6 sides, 0.55 back) with soft folds deepening toward the hem, the
  front panels hanging nearly straight (`flare` 0.22, the open coat edges), and the lavender torn
  zone over the lower 55 % of every lower segment (6 more meshes). Kite greaves on the shins
  (§2.10). A bigger scalp cap with longer locks lying over it, crown wisps curling back, lower side
  flicks and a shorter fringe so the face shows. Thicker sleeves (0.064 / 0.056 m). Brighter armour
  fill and more glints. 127 meshes, ~20.1k triangles (round 1: 121 / 17.7k).

**Poses and motion** (`anim.js`, `player.js`, `fx.js`; every attack's active frames bit-identical,
ADR-024):
- Idle (round 2): the portrait's wide contrapposto with the blade's long low diagonal (§4.2 note);
  the coat flares asymmetrically while he stands (`IDLE_FLARE`). It is the base pose the other clips
  blend from, so windup and recovery frames changed by up to 45 cm while active frames did not.
- Gait and feet (round 1, ADR-023): stride and cycle length follow the speed (walk with double
  support, run with a flight phase, the swing leaves and lands at ground speed, heel peel, a body bob
  on contact, lean from a smoothed speed plus an acceleration spring, banking into curves, hips and
  shoulders counter-rotating); a world-space foot planner holds planted feet through starts, stops,
  curves and turns; the drawn heading trails a fast turn on a spring (`TURN_K` 650 since round 2,
  was 420: peak hip lag in a standing 180° turn 76 → 64°). Sprint hair blows back 13–21° per lock
  (`HAIR_DRAG` 0.06; the sheet's 20°).
- Blade paths (round 1): azimuth / elevation blending round the outside, fades that keep their way
  round (no 350° spin between light 1 and light 2), the blade pushed out of the leg capsules, a
  forward guard when backpedalling, attack entries easing in from rest, recoveries kept out of the
  body.
- Light attacks (round 2): light 1's over-the-shoulder windup loop and aiming free hand (§4.6 note);
  both sweeps hold their rising finish ~4 frames (`FINISH`) and flare the coat as they snap.
- Slam (round 2): gather, raise up the right side, apex (§4.8 note); an impact settle.
- Charge and thrust (round 2): the coiling hold with the updraft and the two-step dash (§4.7 note).
- Roll (round 1 + 2): the blade held in body axes at his right side, a push-off from planted feet,
  then the intended sliding kneel with skid dust and point sparks (§4.5 note). The backstep is a
  real hop.
- Smaller (round 2): repeated RMB taps no longer shuffle the feet (3 lifts → 0); the stagger jolts
  the blade relative to the guard (swing 136 → 54°); the flask swig lifts the elbow out and tips the
  head back (readable from behind) while the guard holds; coat floor contact is exact and
  rate-limited and strips stay above the grass (round 1).

**Measured.**
- Reference view (round 2): figure mean luma 98.9 → 106.2 (reference 108.4), share above 120
  29.2 → 37.1 % (37.9 %), below 50 30.8 → 27.6 % (28.8 %).
- Game camera, hero alone on black (round 2): facing the camera mean / p50 / above-120 104 / 99 /
  42.7 % → 97 / 79 / 33.4 %; facing away 113 / 121 / 50.7 % → 80 / 65 / 24.3 %. The reference scaled
  to that size: 56 / 46 / 6 %.
- Feet (round 1, mean planted-foot slide): run 0.80 / 0.63 → 0.03 / 0.00 m/s, walk 0.80 / 0.58 →
  0.06 / 0.03, strafe 1.15 / 1.10 → 0.06 / 0.05, combo 2.31 / 2.06 → 0.14 / 0.21; blade inside the
  body: 0 frames in every clip (was 1–29). Round 2: thrust front foot 0.60 → 0.01 m/s.
- Gameplay: round 2's blade compare covered 192 hit-tested frames of light 1, light 2, the slam and
  the thrust from several entries: 0 differ. The REACH table and the `hero` scenario are unchanged.
- Cost: within run-to-run noise (game camera 1.38–1.43 ms render on an RTX 4090; animator
  0.31–0.37 ms; peak live FX particles in attack loops 352 → 501 from the denser trail).

**Still open.**
- The coat still reads as separate flat panels and fins with outlines; the reference's is one wide
  ragged drape with holes and blotches (a one-piece skirt or edge-sharing panels, plus burn holes).
- Proportions (shoulders, waist, legs, skull) are round 1's; only the sleeves and hair grew.
- At the game camera he is still brighter than the reference (mean 80–97 vs 56): the blade glow, the
  rim and the armour column (pauldron over vambrace, a bright white stack from the front); the
  capital fill letters (`A B H G`) can read as text at 4x6.
- Hair: a rounder mop of straight clumps; the reference's curved violet-white strand lines and
  floating wisps are missing. Face: a pale patch with one eye; no nose, mouth or eye shadow.
- The halo does not darken the wyrm's letters, so over the dragon he has no cut-out.
- At the reference angle (yaw 20) the idle is still close to frontal; a bigger chest turn would turn
  his gameplay idle away from the target.
- Strike key poses are limited by the bit-identical rule; light 1's loop is fast (~5.9 m of point
  travel in 0.1 s; a longer windup would be a tuning decision); light 2 has no free-arm
  choreography; from behind at 36 m the thrust's legs are mostly hidden by the coat; the knockdown's
  blade still swings ~150° out to his right; Ghostep's reappear and the backstep were not reworked
  in round 2.
- The roll's planted-foot slide metric rose by design (the shin slides with the gameplay root);
  shorten the kneel window, not the pose, if it should drop.
- hero-motion's foot-slide metrics were not re-run on the merged wide idle.
