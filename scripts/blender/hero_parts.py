# Run by scripts/blender/build-hero-parts.mjs inside a headless Blender:
#   blender --background --factory-startup --python hero_parts.py -- <dims.json> <out heroParts.js>
#
# Models the hero's sculpted parts with bmesh / mathutils and writes them as packed vertex data
# (src/entities/player/heroParts.js) that model.js hangs on the rig's joints (ADR-037).
#
# Everything here is in GAME coordinates: x = the hero's LEFT, y = up, z = the way he faces, metres.
# Each part is modelled in the space of the joint it hangs on (see the `yXx` helpers). Per vertex:
#   position, normal, aGUV (roughly metric: x across, y along / up) and aPart, the ink-line sub-id:
#   the art pass draws a line where it changes; 0 / 1 = plain sub-pieces, a smooth 0..0.9 field
#   prints its 0.5 contour as a drawn crease (model.js foldLines).
# Front faces are counter-clockwise seen from outside, as in three.js.
import base64
import json
import math
import random
import struct
import sys

import bmesh
import bpy
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index('--') + 1:]
with open(argv[0], encoding='utf-8') as fh:
    D = json.load(fh)
OUT = argv[1]
DIM, BODY, REST, HAIR_CLUSTERS, CAPE = D['DIM'], D['BODY'], D['REST'], D['HAIR_CLUSTERS'], D['CAPE_SHEETS']

TAU = math.pi * 2


def lerp(a, b, t):
    return a + (b - a) * t


def clamp01(t):
    return 0.0 if t < 0 else 1.0 if t > 1 else t


def smooth(a, b, x):
    t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def poly(pts, x):
    """Piecewise-linear y(x) through pts = [(x, y), ...] (x ascending)."""
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return lerp(y0, y1, (x - x0) / (x1 - x0)) if x1 > x0 else y1
    return pts[-1][1]


# ------------------------------------------------------------------ mesh builder
class Geo:
    """A bmesh with the per-vertex layers the game needs."""

    def __init__(self):
        self.bm = bmesh.new()
        self.k = self.bm.verts.layers.float.new('k')
        self.gu = self.bm.verts.layers.float.new('gu')
        self.gv = self.bm.verts.layers.float.new('gv')

    def vert(self, co, gu=0.0, gv=0.0, k=0.0):
        v = self.bm.verts.new(co)
        v[self.gu], v[self.gv], v[self.k] = gu, gv, k
        return v

    def face(self, vs):
        try:
            return self.bm.faces.new(vs)
        except ValueError:
            return None

    def grid(self, cols, rows, fn, k=0.0, flip=False, closed=False, ss=None, ts=None, keep=None):
        """fn(s, t) -> (co, gu, gv[, k]); s across (cols), t along (rows). The front face is the
        side Ps x Pt points to (flip reverses it). closed = s wraps round. ss / ts = explicit
        sample lists instead of even steps."""
        ss = ss or [i / cols for i in range(cols + 1)]
        ts = ts or [j / rows for j in range(rows + 1)]
        nc = len(ss) - 1 if closed else len(ss)
        vs = []
        for t in ts:
            row = []
            for i in range(nc):
                r = fn(ss[i], t)
                row.append(self.vert(r[0], r[1], r[2], r[3] if len(r) > 3 else k))
            vs.append(row)
        for j in range(len(ts) - 1):
            for i in range(len(ss) - 1):
                i1 = (i + 1) % nc
                if keep and not keep((ss[i] + ss[i + 1]) / 2, (ts[j] + ts[j + 1]) / 2):
                    continue
                a, b, c, d = vs[j][i], vs[j][i1], vs[j + 1][i], vs[j + 1][i1]
                self.face([a, c, d, b] if flip else [a, b, d, c])
        return vs

    def tube(self, pts, r, k=0.0, radial=4, ref=Vector((0, 1, 0))):
        """A thin round bar along a polyline (piping, rims)."""
        n = len(pts)

        def fn(s, t):
            i = max(0, min(n - 1, round(t * (n - 1))))
            p = pts[i]
            T = pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]
            if T.length < 1e-9:
                T = Vector((0, 1, 0))
            T.normalize()
            S = T.cross(ref)
            if S.length < 0.05:
                S = T.cross(Vector((1, 0, 0)))
            S.normalize()
            N = S.cross(T)
            a = s * TAU
            return (p + S * (math.cos(a) * r) + N * (math.sin(a) * r), s * r * 6, t * (n - 1) * 0.01)

        self.grid(radial, n - 1, fn, k=k, flip=True, closed=True)

    def translate(self, v):
        bmesh.ops.translate(self.bm, verts=self.bm.verts[:], vec=Vector(v))
        return self

    def bake(self, sharp=50.0):
        """→ (positions, normals, guv, k, indices): triangles, normals smoothed across edges
        flatter than `sharp` degrees."""
        bm = self.bm
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.normal_update()
        bm.verts.index_update()
        cs = math.cos(math.radians(sharp))
        area = {f: f.calc_area() for f in bm.faces}
        seen, P, N, UV, K, I = {}, [], [], [], [], []
        for f in bm.faces:
            if area[f] < 1e-11:
                continue
            for lp in f.loops:
                v = lp.vert
                n = Vector((0, 0, 0))
                for g in v.link_faces:
                    if area[g] >= 1e-11 and g.normal.dot(f.normal) >= cs:
                        n += g.normal * area[g]
                if n.length < 1e-12:
                    n = f.normal.copy()
                n.normalize()
                key = (v.index, round(n.x, 2), round(n.y, 2), round(n.z, 2))
                idx = seen.get(key)
                if idx is None:
                    idx = seen[key] = len(K)
                    P.extend(v.co)
                    N.extend(n)
                    UV.extend((v[self.gu], v[self.gv]))
                    K.append(v[self.k])
                I.append(idx)
        bm.free()
        return P, N, UV, K, I


PARTS = {}


def emit(name, geo, sharp=50.0):
    P, N, UV, K, I = geo.bake(sharp)
    n = len(K)
    if n == 0 or n > 65535:
        raise RuntimeError(f'part {name}: {n} vertices')

    def q16(a):
        return struct.pack(f'<{len(a)}h', *(max(-32767, min(32767, round(x * 8192))) for x in a))

    b64 = lambda b: base64.b64encode(b).decode('ascii')
    PARTS[name] = {
        'n': n,
        'p': b64(q16(P)),
        'nrm': b64(struct.pack(f'<{len(N)}b', *(max(-127, min(127, round(x * 127))) for x in N))),
        'uv': b64(q16(UV)),
        'k': b64(struct.pack(f'<{n}B', *(max(0, min(200, round(x * 200))) for x in K))),
        'i': b64(struct.pack(f'<{len(I)}H', *I)),
        'tris': len(I) // 3,
    }


# ------------------------------------------------------------------ the body the parts are fitted to
SHELL = BODY['shell']


def shell_at(h):
    """The torso shell's ring at world idle height h (model.js shellAt)."""
    k = 0
    while k < len(SHELL) - 2 and SHELL[k + 1]['y'] < h:
        k += 1
    A, B = SHELL[k], SHELL[k + 1]
    u = clamp01((h - A['y']) / (B['y'] - A['y']))
    g = lambda key: lerp(A.get(key, 0.0), B.get(key, 0.0), u)
    return {'rx': g('rx'), 'rz': g('rz'), 'cz': g('cz'), 'gap': g('gap')}


def shell_z(h, x, side=1):
    R = shell_at(h)
    return side * math.sqrt(max(0.0, 1 - (x / R['rx']) ** 2)) * R['rz'] + R['cz']


y_sp = lambda h: h - REST['spine']  # world idle height → spine-joint local y
y_ch = lambda h: h - REST['chest']
y_pe = lambda h: h - REST['pelvis']


# ------------------------------------------------------------------ hair (head space)
# A big rounded messy mop (the single-figure reference: ~0.30 m across, ~0.25 m tall): a lumpy
# under-volume on the head joint and chunky pointed locks in layers on the five spring clusters:
# crown spikes radiating from a whorl, side and nape locks flicking out at the tips, a fringe down
# over the eyes, and thin stray wisps on the outline.
SK = Vector(DIM['skull'])  # skull centre in head space
CAP_C = SK + Vector((0, 0.02, -0.013))
CAP_R = Vector((0.108, 0.104, 0.116))


def cap_point(az, el, f=1.0):
    """Point on the hair volume: az from the front toward his left, el up from level (radians)."""
    ce = math.cos(el)
    return CAP_C + Vector((math.sin(az) * ce * CAP_R.x, math.sin(el) * CAP_R.y, math.cos(az) * ce * CAP_R.z)) * f


def cap_out(p):
    """Outward normal of the hair volume through p."""
    q = p - CAP_C
    n = Vector((q.x / CAP_R.x ** 2, q.y / CAP_R.y ** 2, q.z / CAP_R.z ** 2))
    return n.normalized() if n.length > 1e-9 else Vector((0, 1, 0))


def cap_push(p, m):
    """Keep p at least (1 + m) x the hair volume's radius out from its centre."""
    q = p - CAP_C
    s = math.sqrt((q.x / CAP_R.x) ** 2 + (q.y / CAP_R.y) ** 2 + (q.z / CAP_R.z) ** 2)
    if s < 1e-6:
        return p
    return CAP_C + q * ((1 + m) / s) if s < 1 + m else p


def hair_cap():
    g = Geo()
    bmesh.ops.create_icosphere(g.bm, subdivisions=3, radius=1.0)
    for v in g.bm.verts:
        d = v.co.normalized()
        lump = 1 + 0.05 * noise.noise(d * 2.3 + Vector((3.1, 1.7, 0.4)))
        p = CAP_C + Vector((d.x * CAP_R.x, d.y * CAP_R.y, d.z * CAP_R.z)) * lump
        # open under the brow in front (the face), lower over the ears, down to the nape behind
        cut = SK.y + lerp(0.03, -0.085, smooth(0.07, -0.07, p.z))
        if p.y < cut:
            p.y = cut - (cut - p.y) * 0.12
            p.x *= 0.9
            p.z = CAP_C.z + (p.z - CAP_C.z) * 0.9
        v.co = p
        v[g.gu], v[g.gv], v[g.k] = math.atan2(d.x, d.z) * 0.11, p.y, 0.0
    return g


def hair_lock(gm, gt, p0, d0, L, w, th, bend, k, margin, split=0.62, radial=6):
    """One pointed lock: an ellipse swept from p0 along d0, bending by `bend`, lying on the hair
    volume (never closer than `margin`), widest a quarter of the way down. Its root stretch goes to
    gm (the dark mass), the tip stretch to gt (the lighter tips)."""
    d0 = d0.normalized()

    def path(t):
        p = p0 + d0 * (L * t) + bend * (L * t * t)
        return cap_push(p, lerp(-0.06, margin, clamp01(t / 0.22)))

    state = {'S': None}

    def ring(s, t):
        p = path(t)
        T = path(min(1.0, t + 0.04)) - path(max(0.0, t - 0.04))
        T.normalize()
        S = T.cross(cap_out(p))
        if S.length < 0.25 and state['S'] is not None:
            S = state['S'] - T * state['S'].dot(T)
        if S.length < 1e-6:
            S = T.cross(Vector((0, 1, 0)))
        S.normalize()
        state['S'] = S
        N = S.cross(T)
        f = min(1.0, 0.45 + 2.2 * t) * (max(0.0, 1 - t) ** 0.75)
        a = s * TAU
        co = p + S * (math.cos(a) * w * f) + N * (math.sin(a) * max(th * f, 0.0))
        return (co, (a - math.pi) * max(w, 0.02), t * L)

    gm.grid(radial, 4, ring, k=k, flip=True, closed=True, ts=[split * j / 4 for j in range(5)])
    gt.grid(radial, 3, ring, k=k, flip=True, closed=True, ts=[lerp(split, 1.0, j / 3) for j in range(4)])


def build_hair():
    rnd = random.Random(7)
    R = lambda a, b: rnd.uniform(a, b)
    geos = {c['name']: (Geo(), Geo()) for c in HAIR_CLUSTERS}
    count = {c['name']: 0 for c in HAIR_CLUSTERS}
    Y = Vector((0, 1, 0))

    def add(cluster, az, el, side, lift, L, w, th, flick, margin, up=0.0, lines=None):
        """A lock rooted at (az, el) on the hair volume, flowing DOWN the head (away from the whorl),
        swept `side` round it, lifting off by `lift`; the tip flicks outward by `flick` (and up)."""
        p0 = cap_point(az, el)
        O = cap_out(p0)
        H = Vector((math.sin(az), 0, math.cos(az)))  # level, away from the head's axis
        Sd = Vector((math.cos(az), 0, -math.sin(az)))  # level, round the head (toward +az)
        Td = Vector((math.sin(az) * math.sin(el) * CAP_R.x, -math.cos(el) * CAP_R.y, math.cos(az) * math.sin(el) * CAP_R.z))
        Td.normalize()
        d0 = Td + Sd * side + O * lift
        bend = H * flick + Y * up
        n = count[cluster]
        count[cluster] += 1
        gm, gt = geos[cluster]
        k = (1 if n % 4 == 1 else 0) if lines is None else (1 if lines else 0)
        hair_lock(gm, gt, p0, d0, L, w, th, bend, k, margin)

    def side_of(az):
        a = (az + math.pi) % TAU - math.pi
        if abs(a) > 1.95:
            return 'nape'
        return 'left' if a > 0 else 'right'

    front = lambda az: abs((az + math.pi) % TAU - math.pi)

    # crown: short chunky locks radiating from the whorl, their tips kicking up: the spiky top outline
    n = 9
    for i in range(n):
        az = TAU * (i + R(-0.3, 0.3)) / n
        add('crown', az, R(1.0, 1.3), R(-0.5, 0.5), 0.1, R(0.07, 0.095), R(0.034, 0.044), 0.014, R(0.0, 0.15), R(0.03, 0.07), up=R(0.0, 0.2))
    # the layer below: bigger locks over the sides and the back, the tips flicking out
    n = 11
    for i in range(n):
        az = TAU * (i + 0.5 + R(-0.3, 0.3)) / n
        if front(az) < 0.6:
            continue  # the fringe's place
        add(side_of(az) if rnd.random() < 0.6 else 'crown', az, R(0.55, 0.85), R(-0.45, 0.45), 0.04, R(0.085, 0.11), R(0.036, 0.048), 0.015,
            R(0.1, 0.3), R(0.03, 0.07), up=R(0.0, 0.1))
    # sides and nape: locks over the ears and down to the collar, the tips flicking out
    n = 13
    for i in range(n):
        az = lerp(0.8, TAU - 0.8, (i + R(-0.25, 0.25) + 0.5) / n)
        back = front(az) > 1.95
        add(side_of(az), az, R(0.15, 0.45), R(-0.35, 0.35), 0.05, R(0.1, 0.13) if back else R(0.085, 0.11), R(0.034, 0.046), 0.015,
            R(0.15, 0.35), R(0.0, 0.05), up=R(0.0, 0.08))
    # fringe: locks down over the forehead to the brow, the middle ones to the eyes; the face shows below
    n = 8
    for i in range(n):
        u = (i + R(-0.2, 0.2)) / (n - 1) * 2 - 1
        mid = 1 - abs(u)
        add('fringe', u * 1.0, R(0.6, 0.78), -u * 0.3 + R(-0.2, 0.2), 0.0, lerp(0.075, 0.1, mid) + R(-0.008, 0.01),
            R(0.03, 0.04), 0.012, R(-0.45, -0.3), R(0.06, 0.09), lines=(i % 3 == 1))
    # wisps: thin stray locks breaking the outline
    for i in range(14):
        az = R(0, TAU)
        el = R(0.0, 1.25)
        if front(az) < 0.75 and el < 0.7:
            continue
        add('crown' if el > 0.8 else side_of(az), az, el, R(-0.7, 0.7), 0.4, R(0.04, 0.07), R(0.011, 0.016), 0.007, R(0.3, 0.6), 0.0,
            up=R(0.1, 0.5), lines=False)

    emit('hair.cap', hair_cap(), sharp=80)
    for c in HAIR_CLUSTERS:
        gm, gt = geos[c['name']]
        piv = Vector(c['pivot'])
        emit(f"hair.{c['name']}.mass", gm.translate(-piv), sharp=70)
        emit(f"hair.{c['name']}.tip", gt.translate(-piv), sharp=70)


# ------------------------------------------------------------------ collar (chest space)
# A tall winged collar: low at the nape, rising round the sides into two big pointed wings that
# flare out beside the jaw (tips ~0.145 m out at ~1.63 m), the front open in a deep V down to the
# chest. One sheet: model.js draws its outside with `collar` and its inside with `collarIn`.
COL = {'y0': 1.49, 'back': 1.588, 'wing': 0.045, 'front': 1.525, 'peak': 1.05, 'z': -0.004}


def collar_fn(s, t):
    gap = lerp(0.2, 0.62, t ** 1.2)
    th = lerp(gap, TAU - gap, s)
    a = th if th < math.pi else TAU - th  # angle from the front
    if a >= COL['peak']:
        wing = max(0.0, 1 - (a - COL['peak']) / 0.85)
        top = COL['back'] + COL['wing'] * wing
    else:
        wing = clamp01((a - gap) / max(1e-6, COL['peak'] - gap))
        top = lerp(COL['front'], COL['back'] + COL['wing'], wing ** 0.8)
    wing = clamp01(wing)
    f = t ** 1.35
    rx = lerp(0.086, 0.116 + 0.052 * wing ** 1.5, f)
    rz = lerp(0.078, 0.098 + 0.03 * wing ** 1.5, f)
    h = lerp(COL['y0'], top, t)
    co = Vector((math.sin(th) * rx, y_ch(h), math.cos(th) * rz + COL['z']))
    return (co, (th - math.pi) * 0.1, y_ch(h))


def build_collar():
    g = Geo()
    g.grid(44, 6, collar_fn)
    emit('collar', g, sharp=75)
    # the bright turned edge along the top and down both front edges
    rim = Geo()
    edge = [collar_fn(0, j / 6)[0] for j in range(7)]
    edge += [collar_fn(i / 44, 1)[0] for i in range(1, 44)]
    edge += [collar_fn(1, 1 - j / 6)[0] for j in range(7)]
    rim.tube(edge, 0.0032, radial=4)
    emit('collar.rim', rim, sharp=180)


# ------------------------------------------------------------------ lapels (spine space)
# Broad peaked lapels laid on the coat front from the collar to the belt, the outer edge standing
# a little proud; a bright piped edge.
LAPEL_W = [(0.0, 0.02), (0.3, 0.082), (0.345, 0.092), (0.38, 0.06), (0.62, 0.042), (1.0, 0.012)]
LAPEL_T = [0.0, 0.1, 0.2, 0.3, 0.345, 0.38, 0.5, 0.62, 0.75, 0.88, 1.0]


def lapel_fn(side, u, t):
    h = lerp(1.49, 1.232, t)
    R = shell_at(h)
    x = side * (max(0.008, R['gap'] - 0.006) + u * poly(LAPEL_W, t))
    x = max(-R['rx'] * 0.97, min(R['rx'] * 0.97, x))
    z = shell_z(h, x) + 0.007 + 0.011 * u
    return (Vector((x, y_sp(h), z)), x, y_sp(h))


def build_lapels():
    g, e = Geo(), Geo()
    for side in (1, -1):
        g.grid(3, len(LAPEL_T) - 1, lambda u, t, s=side: lapel_fn(s, u, t), flip=side > 0, ts=LAPEL_T)
        e.tube([lapel_fn(side, 1, t)[0] + Vector((0, 0, 0.002)) for t in LAPEL_T], 0.003, ref=Vector((0, 0, 1)))
    emit('lapel', g, sharp=60)
    emit('lapel.edge', e, sharp=180)


# ------------------------------------------------------------------ sword blade (sword space)
# Origin = grip centre, the blade along +Z, its width on X, the flats facing ±Y. A broad dark blade
# with a centre ridge, three raking barbs up each edge (staggered left / right), an arrowhead point.
# The two halves either side of the ridge carry sub-ids 0 / 1, so the ridge prints as a line.
# The profile was drawn for a 1.45 m point; BK rescales everything past the forte to DIM.drawnTip.
BK = (DIM['drawnTip'] - 0.2) / 1.25
bz = lambda z: 0.2 + (z - 0.2) * BK
BLADE = {'z0': 0.11, 'zT': bz(1.2), 'ridge': 0.012, 'core': 0.66}


def blade_base(z):
    """Half-width of the blade's body (without barbs) at z."""
    return lerp(0.05, 0.034, clamp01((z - 0.17) / (BLADE['zT'] - 0.17)))


def blade_profile(side):
    z0, zT, tip = BLADE['z0'], BLADE['zT'], DIM['drawnTip']
    base = blade_base
    pts = [(z0, 0.034), (0.132, 0.064), (0.15, 0.05), (0.17, base(0.17))]
    for j, zb in enumerate((0.38, 0.63, 0.88)):
        zb = bz(zb + (0.115 if side > 0 else 0.0))
        za = zb - 0.15 * BK
        pts += [(za, base(za)), (zb, base(zb) + 0.026 - 0.004 * j), (zb + 0.014, base(zb + 0.014) - 0.004)]
    pts += [(zT - 0.03, base(zT)), (zT + 0.03, 0.06), (tip, 0.0)]
    return pts


def build_blade():
    tip = DIM['drawnTip']
    forte, core, edge = Geo(), Geo(), Geo()
    for side in (-1, 1):
        pr = blade_profile(side)

        def pt(fr, z, top, side=side, pr=pr):
            """fr 0 = the ridge … 1 = the cutting edge (the body's core ends at BLADE.core of the
            barbless width, so every barb is all bright edge)."""
            hw = poly(pr, z)
            th = BLADE['ridge'] * clamp01((tip - z) / 0.2) ** 0.7
            inner = min(hw, blade_base(z)) * BLADE['core'] * clamp01((tip - z) / 0.12)
            x = lerp(0.0, inner, fr / 0.5) if fr <= 0.5 else lerp(inner, hw, (fr - 0.5) / 0.5)
            y = th * (1 - x / hw) if hw > 1e-6 else 0.0
            co = Vector((side * x, y if top else -y, z))
            return (co, co.x, z)

        zs = lambda za, zb: sorted({za, zb, *(z for z, _ in pr if za < z < zb)})
        k0, k1 = (0.0, 1.0) if side < 0 else (1.0, 0.0)
        # the gunmetal forte: plain halves
        za, zb = BLADE['z0'], DIM['forte']
        forte.grid(2, 1, lambda s, z: pt(1 - abs(2 * s - 1), z, s < 0.5), k=k0, flip=side > 0, ts=zs(za, zb), ss=[0, 0.5, 1])
        # the steel: a dark core either side of the ridge, a bright band out to the edge
        za, zb = DIM['forte'], tip
        core.grid(1, 1, lambda s, z: pt(0.5 * s, z, True), k=k0, flip=side > 0, ts=zs(za, zb), ss=[0, 1])
        core.grid(1, 1, lambda s, z: pt(0.5 * s, z, False), k=k0, flip=side < 0, ts=zs(za, zb), ss=[0, 1])
        edge.grid(2, 1, lambda s, z: pt(1 - 0.5 * abs(2 * s - 1), z, s < 0.5), k=k1, flip=side > 0, ts=zs(za, zb), ss=[0, 0.5, 1])
    emit('blade.forte', forte, sharp=25)
    emit('blade.core', core, sharp=25)
    emit('blade.edge', edge, sharp=25)


# ------------------------------------------------------------------ cape (streamer-segment space)
# The torn half-cape (model.js CAPE_SHEETS): wide ragged sheets on the streamer springs. Each sheet
# hangs -Y from its base joint, +X across, +Z outward (its outer face); the upper segment (.a) and
# the dark part of the lower one (.b) are coat cloth, the torn ends (.c) the lavender hem: claw
# points of uneven length, ragged sides, a few holes. The billow and the folds are baked in.
def build_cape():
    for i, c in enumerate(CAPE):
        L0, L1 = c['len']
        L = L0 + L1
        sd = c['seed'] * 0.731
        tj = L0 / L
        n1 = lambda x, o=0.0, sd=sd: noise.noise(Vector((x, sd + o, 0.37)))

        def hemline(s, n1=n1, tj=tj):
            return max(tj + 0.08, 0.68 + 0.09 * n1(s * 2.3, 3.0))

        def bottom(s, n1=n1, sd=sd, hemline=hemline):
            saw = abs(((s * 2.6 + sd) % 1.0) - 0.5) * 2  # 0..1: the claws
            b = 1.0 - 0.34 * abs(n1(s * 1.9, 5.0)) - (0.2 + 0.14 * n1(s * 1.1, 7.0)) * saw
            return max(hemline(s) + 0.07, min(1.0, b))

        def P(s, t, c=c, L=L, n1=n1, sd=sd):
            h = 0.5 * lerp(c['w'][0], c['w'][1], clamp01(t) ** 0.85)
            h *= 1 + 0.16 * t * n1(t * 7.0, 9.0 if s > 0 else 12.0) * abs(s) ** 3  # ragged sides
            x = s * h + 0.04 * t * n1(t * 1.7, 20.0)
            fold = math.sin(s * 2.9 + sd * 2.3 + t * 1.6)
            z = c['cup'] * (1 - s * s) * math.sin(math.pi * clamp01(t) ** 0.8) + 0.022 * t * fold + 0.02 * t * n1(s * 1.5 + t * 2.0, 31.0)
            w = smooth(0.3, 0.7, t)  # the folds open toward the torn end: no crease near the root
            k = min(0.9, max(0.0, 0.5 + 0.4 * w * math.sin(s * 2.2 + sd * 1.3 + t * 1.2) - 0.1 * (1 - w)))
            return (Vector((x, -t * L, z)), x, -t * L, k)

        cols = 18
        ss = [-1 + 2 * j / cols for j in range(cols + 1)]
        ga, gb, gc = Geo(), Geo(), Geo()
        ga.grid(cols, 7, lambda s, u, P=P, tj=tj: P(s, u * tj), flip=True, ss=ss)
        off = Vector((0, L0, 0))

        def fb(s, u, P=P, tj=tj, hemline=hemline, off=off):
            r = P(s, lerp(tj, hemline(s), u))
            return (r[0] + off, r[1], r[2], r[3])

        def fc(s, u, P=P, hemline=hemline, bottom=bottom, off=off):
            r = P(s, lerp(hemline(s), bottom(s), u))
            return (r[0] + off, r[1], r[2], r[3])

        def hole(s, u, sd=sd):
            return not (0.12 < u < 0.8 and noise.noise(Vector((s * 3.4, u * 3.1, sd + 40.0))) > 0.42)

        gb.grid(cols, 4, fb, flip=True, ss=ss)
        gc.grid(cols, 6, fc, flip=True, ss=ss, keep=hole)
        emit(f'cape.{i}.a', ga, sharp=60)
        emit(f'cape.{i}.b', gb, sharp=60)
        emit(f'cape.{i}.c', gc, sharp=60)


# ------------------------------------------------------------------ pauldron (pauldron-joint space)
# The right shoulder's plates (the joint sits at the shoulder; outward = -X, front = +Z): a cap over
# the shoulder and a lame under it, each a piece of a spheroid whose pole leans outward, its lower
# edge cut into points and flared so it stands off the one below; a bright bevel along each edge;
# short flat blades rising from the cap. The lower lames ride on the arm (model.js).
PAUL = {
    'c': (-0.012, 0.02, 0.0), 'tilt': 0.35,
    'cap': {'r': (0.104, 0.082, 0.11), 'phi': 2.3, 'th': (0.0, 1.02), 'pts': (-0.6, 0.0, 0.6), 'drop': 0.34, 'flare': 0.1},
    'lame': {'r': (0.097, 0.118, 0.103), 'phi': 1.9, 'th': (1.3, 1.62), 'pts': (-0.45, 0.45), 'drop': 0.36, 'flare': 0.12},
}


def lame_pt(L, a, u, grow=1.0):
    """a = -1 (front) .. 1 (back) round the shoulder, u = 0 (top) .. 1 (the cut lower edge)."""
    pt = max(max(0.0, 1 - abs(a - c) / 0.3) for c in L['pts'])
    th = lerp(L['th'][0], L['th'][1] + L['drop'] * pt - 0.2 * smooth(0.8, 1.0, abs(a)), u)
    fl = (1 + L['flare'] * smooth(0.55, 1.0, u)) * grow
    ph = a * L['phi']
    h, v = math.sin(th), math.cos(th)
    x, y, z = -math.cos(ph) * h * L['r'][0] * fl, v * L['r'][1], -math.sin(ph) * h * L['r'][2] * fl
    ct, st = math.cos(PAUL['tilt']), math.sin(PAUL['tilt'])
    return Vector(PAUL['c']) + Vector((x * ct - y * st, x * st + y * ct, z))


def build_pauldron():
    plate, bevel, spike = Geo(), Geo(), Geo()
    cols = 40
    ss = [-1 + 2 * j / cols for j in range(cols + 1)]
    for n, key in enumerate(('cap', 'lame')):
        L = PAUL[key]
        plate.grid(cols, 8, lambda a, u, L=L: (lame_pt(L, a, u), a * L['phi'] * 0.1, -u * 0.12), k=float(n), ss=ss)
        bevel.grid(cols, 1, lambda a, u, L=L: (lame_pt(L, a, 1 - 0.1 * (1 - u), 1.03), a * L['phi'] * 0.1, -u * 0.01), ss=ss)

    def fin(base, D, W, Lf, w, th, bend, k):
        D = Vector(D).normalized()
        W = (W - D * W.dot(D)).normalized()
        T = D.cross(W)
        bend = Vector(bend)
        rows = 6
        for sgn in (1, -1):
            def fn(s, t, sgn=sgn):
                c = base + D * (Lf * t) + bend * (Lf * t * t)
                hw = w * (1 - t ** 1.4)
                return (c + W * (s * hw) + T * (sgn * th * (1 - abs(s)) * (1 - t)), s * hw, Lf * t)
            spike.grid(2, rows, fn, k=k, flip=(sgn > 0), ss=[-1, 0, 1])

    cap = PAUL['cap']
    for a, u, D, Lf, w, bend, k in (
        (0.12, 0.22, (-0.1, 1.0, -0.2), 0.06, 0.03, (0.0, 0.0, -0.3), 0.0),  # by the collar
        (0.38, 0.5, (-0.55, 0.85, -0.3), 0.085, 0.036, (0.0, 0.25, -0.3), 1.0),  # the tallest: up and out
        (-0.28, 0.62, (-0.85, 0.55, 0.12), 0.065, 0.032, (0.0, 0.35, 0.0), 0.0),  # out over the arm
        (0.72, 0.72, (-0.35, 0.4, -0.85), 0.06, 0.03, (0.0, 0.3, 0.0), 1.0),  # back
    ):
        b = lame_pt(cap, a, u)
        Wd = lame_pt(cap, a + 0.02, u) - lame_pt(cap, a - 0.02, u)
        fin(b - Vector(D).normalized() * 0.012, D, Wd, Lf + 0.012, w, 0.007, bend, k)
    emit('pauldron.plate', plate, sharp=40)
    emit('pauldron.bevel', bevel, sharp=180)
    emit('pauldron.spike', spike, sharp=30)


# ------------------------------------------------------------------ run
build_hair()
build_collar()
build_lapels()
build_blade()
build_cape()
build_pauldron()

lines = [
    '// GENERATED by scripts/blender/build-hero-parts.mjs (scripts/blender/hero_parts.py, Blender '
    + bpy.app.version_string + '). Do not edit.',
    '// The hero\'s sculpted parts as packed vertex data: n vertices; base64 little-endian p = Int16',
    '// positions / 8192 m, nrm = Int8 normals / 127, uv = Int16 aGUV / 8192, k = Uint8 aPart / 200,',
    '// i = Uint16 triangle indices. Decoded by model.js partGeometry().',
    'export const HERO_PARTS = {',
]
tv = tt = 0
for name in sorted(PARTS):
    P = PARTS[name]
    tv += P['n']
    tt += P['tris']
    lines.append(f"  '{name}': {{ n: {P['n']}, p: '{P['p']}', nrm: '{P['nrm']}', uv: '{P['uv']}', k: '{P['k']}', i: '{P['i']}' }},")
lines.append('};')
with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('\n'.join(lines) + '\n')
print(f'HERO_PARTS: {len(PARTS)} parts, {tv} vertices, {tt} triangles -> {OUT}')
for name in sorted(PARTS):
    print(f"  {name}: {PARTS[name]['n']} v, {PARTS[name]['tris']} t")
