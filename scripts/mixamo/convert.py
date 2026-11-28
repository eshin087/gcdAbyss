# Mixamo -> game GLB for the hero trial (?hero=mixamo | mixrig; docs/DECISIONS.md ADR-294).
#
#   blender -b --factory-startup --python scripts/mixamo/convert.py -- <config.json>
#
# config: { mode: 'ninja' | 'herorig', body: <skinned FBX>, clipsDir, clips: { key: <file stem> },
#           obj: <hero T-pose OBJ with aGUV as vt and objects named m<n>__<mat>__<part>__<slot>> (herorig),
#           out: <.glb>, meta: <.json> }
#
# What it writes:
#  - one skinned mesh on the Mixamo skeleton, its polygons in materials named after the hero's
#    material keys (model.js createHeroMaterials), UV0 = aGUV (the letter layout, metres), UV1.x = aPart
#  - every clip as an action named by its game key (root motion is stripped in the game)
#  - meta: per clip its frame count and the frame where the sword hand moves fastest (the contact);
#    the sword's grip axis in the right hand's bone space (from the two-handed hold)
import bpy, bmesh, sys, os, json, math
import mathutils
from mathutils.kdtree import KDTree

cfg = json.load(open(sys.argv[sys.argv.index('--') + 1]))
mode = cfg['mode']
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=cfg['body'])
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in bpy.data.objects: o.select_set(False)
if len(meshes) > 1:
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
body = meshes[0]
body.name = 'heroBody'
me = body.data
for img in list(bpy.data.images): bpy.data.images.remove(img)
me.materials.clear()
mw = body.matrix_world.copy()
names = [g.name for g in body.vertex_groups]

def dom_group(v):
    best, bw = None, 0
    for g in v.groups:
        if g.weight > bw: best, bw = names[g.group], g.weight
    return best or 'mixamorig:Hips'

def bone_head(name):
    b = arm.data.bones.get(name)
    return arm.matrix_world @ b.head_local if b else mathutils.Vector((0, 0, 0))

MATS = {}
def mat_index(key):
    if key not in MATS:
        m = bpy.data.materials.get(key) or bpy.data.materials.new(key)
        me.materials.append(m)
        MATS[key] = len(me.materials) - 1
    return MATS[key]

guv = {}   # vertex index -> (x, y)
part = {}  # vertex index -> aPart
poly_mat = {}

if mode == 'ninja':
    # his head (hair, face) replaces the mask: drop what the head bones carry
    HEAD = {'mixamorig:Head', 'mixamorig:HeadTop_End', 'mixamorig:LeftEye', 'mixamorig:RightEye'}
    bm = bmesh.new(); bm.from_mesh(me)
    dl = bm.verts.layers.deform.active
    kill = []
    for v in bm.verts:
        w = sum(wt for gi, wt in v[dl].items() if names[gi] in HEAD) if dl else 0
        if w > 0.5: kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(me); bm.free()
    hips = bone_head('mixamorig:Hips')
    shoulder = {s: bone_head(f'mixamorig:{s}Arm') for s in ('Left', 'Right')}
    for v in me.vertices:
        p = mw @ v.co
        g = dom_group(v)
        short = g.replace('mixamorig:', '')
        if any(k in short for k in ('Arm', 'Hand', 'Shoulder')) and 'UpLeg' not in short:
            side = 'Left' if p.x > 0 else 'Right'
            s = shoulder[side]
            along = abs(p.x) - abs(s.x)
            r = math.hypot(p.y - s.y, p.z - s.z)
            ang = math.atan2(p.y - s.y, p.z - s.z)
            guv[v.index] = (ang * max(r, 0.02), -along)
        else:
            if 'Leg' in short or 'Foot' in short or 'Toe' in short:
                side = 'Left' if 'Left' in short else 'Right'
                c = bone_head(f'mixamorig:{side}UpLeg'); cx, cy = c.x, hips.y
            else:
                cx, cy = 0.0, hips.y
            r = math.hypot(p.x - cx, p.y - cy)
            ang = math.atan2(p.x - cx, -(p.y - cy))  # 0 at the front (-Y)
            guv[v.index] = (ang * max(r, 0.02), p.z)
        part[v.index] = 0
    def poly_key(poly):
        g = dom_group(me.vertices[poly.vertices[0]]).replace('mixamorig:', '')
        if 'Hand' in g: return 'leather'
        if 'Foot' in g or 'Toe' in g: return 'armor'
        if 'Leg' in g: return 'pants'
        if 'Neck' in g: return 'collar'
        return 'coat'
    for poly in me.polygons: poly_mat[poly.index] = poly_key(poly)

else:  # herorig: his own mesh; take his materials, parts and letter layout back from the OBJ
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=cfg['obj'])
    objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    pts = []  # (world pos, obj index, uv)
    meta_o = []
    for oi, o in enumerate(objs):
        parts = o.name.split('__')
        meta_o.append((parts[1] if len(parts) > 1 else 'coat', float(parts[2]) if len(parts) > 2 else 0.0))
        uvl = o.data.uv_layers.active
        vuv = {}
        if uvl:
            for loop in o.data.loops: vuv[loop.vertex_index] = tuple(uvl.data[loop.index].uv)
        for v in o.data.vertices: pts.append((o.matrix_world @ v.co, oi, vuv.get(v.index, (0, 0))))
    # align the rigged mesh to the OBJ by their boxes (Mixamo may rescale / recentre)
    def box(ps):
        lo = mathutils.Vector((min(p.x for p in ps), min(p.y for p in ps), min(p.z for p in ps)))
        hi = mathutils.Vector((max(p.x for p in ps), max(p.y for p in ps), max(p.z for p in ps)))
        return lo, hi
    olo, ohi = box([p[0] for p in pts])
    wv = [mw @ v.co for v in me.vertices]
    blo, bhi = box(wv)
    k = (ohi.z - olo.z) / max(bhi.z - blo.z, 1e-6)
    def to_obj(p):
        c = (blo + bhi) / 2; oc = (olo + ohi) / 2
        return mathutils.Vector((oc.x + (p.x - c.x) * k, oc.y + (p.y - c.y) * k, olo.z + (p.z - blo.z) * k))
    kd = KDTree(len(pts))
    for i, p in enumerate(pts): kd.insert(p[0], i)
    kd.balance()
    per = {}
    for i, p in enumerate(pts): per.setdefault(p[1], []).append(i)
    kdo = {}
    for oi, ids in per.items():
        t = KDTree(len(ids))
        for j, i in enumerate(ids): t.insert(pts[i][0], i)
        t.balance(); kdo[oi] = t
    err = 0.0
    vobj = {}
    for v in me.vertices:
        q = to_obj(wv[v.index])
        _, i, d = kd.find(q); err = max(err, d)
        vobj[v.index] = pts[i][1]
    for poly in me.polygons:
        c = to_obj(sum((wv[i] for i in poly.vertices), mathutils.Vector()) / len(poly.vertices))
        votes = {}
        for i in poly.vertices: votes[vobj[i]] = votes.get(vobj[i], 0) + 1
        oi = max(votes, key=votes.get)
        poly_mat[poly.index] = (oi,)
    # per loop: the uv of the nearest vertex of the polygon's own source object
    loop_uv = {}
    for poly in me.polygons:
        oi = poly_mat[poly.index][0]
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            _, i, _ = kdo[oi].find(to_obj(wv[vi]))
            loop_uv[li] = pts[i][2]
    for poly in me.polygons:
        oi = poly_mat[poly.index][0]
        poly_mat[poly.index] = meta_o[oi][0]
        for vi in poly.vertices: part[vi] = meta_o[oi][1]
    for o in objs: bpy.data.objects.remove(o, do_unlink=True)
    print('ALIGN max err', err, 'scale', k)

for poly in me.polygons: poly.material_index = mat_index(poly_mat[poly.index])
while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
uv0 = me.uv_layers.new(name='GUV'); uv1 = me.uv_layers.new(name='PART')
for poly in me.polygons:
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index
        uv0.data[li].uv = loop_uv[li] if mode == 'herorig' else guv[vi]
        uv1.data[li].uv = (part.get(vi, 0), 0)

# ---------------------------------------------------------------- clips
sc = bpy.context.scene
sc.render.fps = 30
meta = {'clips': {}, 'mode': mode}
pb = arm.pose.bones
def wpos(name): return arm.matrix_world @ pb[name].head
def use(act):
    arm.animation_data_create(); arm.animation_data.action = act
    try: arm.animation_data.action_slot = act.slots[0]
    except Exception: pass

grip = []
for key, stem in cfg['clips'].items():
    f = os.path.join(cfg['clipsDir'], stem + '.fbx')
    before_a = set(bpy.data.actions); before_o = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=f)
    new = [a for a in bpy.data.actions if a not in before_a]
    for o in set(bpy.data.objects) - before_o: bpy.data.objects.remove(o, do_unlink=True)
    if not new: print('NO ACTION', key); continue
    act = new[0]; act.name = key; act.use_fake_user = True
    use(act)
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    speed = []
    prev = None
    for fr in range(f0, f1 + 1):
        sc.frame_set(fr)
        h = wpos('mixamorig:RightHand') - wpos('mixamorig:Hips') * mathutils.Vector((1, 1, 0))
        if prev is not None: speed.append(((h - prev).length * 30, fr))
        prev = h
        if key in ('idle', 'run', 'walk', 'block'):
            R = arm.matrix_world @ pb['mixamorig:RightHand'].matrix
            L = wpos('mixamorig:LeftHand')
            grip.append(R.inverted() @ L)
    c = max(speed)[1] if speed else f0
    meta['clips'][key] = {'src': stem, 'frames': f1 - f0 + 1, 'contact': c - f0, 'peak': round(max(speed)[0], 2) if speed else 0}
if grip:
    g = sum(grip, mathutils.Vector()) / len(grip)
    meta['grip'] = [round(x, 4) for x in g]  # left hand in the right hand's bone space (metres x 100? see scale)
meta['armScale'] = list(arm.scale)
hb = arm.data.bones['mixamorig:HeadTop_End'] if 'mixamorig:HeadTop_End' in arm.data.bones else arm.data.bones['mixamorig:Head']
meta['height'] = round((arm.matrix_world @ hb.head_local).z, 4)
meta['hipsY'] = round((arm.matrix_world @ arm.data.bones['mixamorig:Hips'].head_local).z, 4)
arm.animation_data.action = None
sc.frame_set(1)

# ---------------------------------------------------------------- export
for o in bpy.data.objects: o.select_set(False)
arm.select_set(True); body.select_set(True)
bpy.context.view_layer.objects.active = arm
kw = dict(filepath=cfg['out'], export_format='GLB', use_selection=True, export_animations=True,
          export_animation_mode='ACTIONS', export_skins=True, export_morph=False, export_materials='EXPORT',
          export_texcoord=True, export_normals=True, export_yup=True, export_force_sampling=True,
          export_optimize_animation_size=True, export_cameras=False, export_lights=False)
kw['export_image_format'] = 'NONE'
known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
print('SKIPPED KW', [k for k in kw if k not in known])
bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in known})
json.dump(meta, open(cfg['meta'], 'w'), indent=1)
print('WROTE', cfg['out'], len(me.vertices), 'verts', len(me.polygons), 'polys', 'mats', list(MATS))
