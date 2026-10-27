"""Bake the /city walkers: PEOPLE_VARIANTS PSX pack characters with a procedural, stepped walk as shape keys.

Run it headless with no .blend (see README "People"):
    flatpak run --command=blender org.blender.Blender --factory-startup -b \
      --python "$PWD/export_people.py" -- [out_dir=build/people] [assets=/run/.../Assets/People]

The pack (Assets/People) is only read, never written. Writes OUT_DIR/people_raw.glb, people_meta.json and
people_atlas.jpg; two runs give byte-identical files.

Stages
  cast         pick_variants (people_cast.py) over the rigged files in RIG_DIRS: one of each UNIFORM_SLOTS,
               the rest civilians by stride. Never a Killer, Monster or Exotic_dancer model.
  pose         per variant: import the FBX, drop its 2-frame bind action, bring the arms down from the A pose
               to ARM_HANG_DEG off vertical (straight), then for each of WALK_KEYS phases set the walk_pose
               angles. Every rotation is about a world axis through the bone's head (the characters face
               Blender +X, left is +Y), so the files' differing bone rolls don't matter: legs and arms swing
               about Y, the pelvis and chest twist about Z, the feet counter-rotate to stay level.
  bake         each phase's deformed vertices (world space, turned to face -Y = glTF +Z, centred on the hips,
               lowest vertex on the ground) become shape key walk_<i>; the basis is walk_0. The armature is
               deleted, so the glb holds plain meshes with WALK_KEYS morph targets. The ground lock gives the
               hip bob (lowest at contact) for free.
  atlas        the variants' 512 px textures (Textures/<image>.png) packed into ATLAS_COLS x ATLAS_ROWS tiles,
               UVs moved into each tile with an ATLAS_INSET_PX inset; one material PEOPLE_Atlas (roughness
               ROUGHNESS, metallic 0). The pack's colours are kept as they are.
  meta         people_meta.json {version, keys, cycle_m, variants: [{name, height, gender, kind, tile,
               cycle_m}]}. cycle_m = 2 steps: twice the heel-to-heel stride at contact, the mean over the cast.

The walk is deliberately chunky: the page steps through the WALK_KEYS poses with no blending (the robots added
later are the fluid ones). The pure parts (cast, walk curves, atlas UVs) are in people_cast.py (tested).
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Matrix, Vector

_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _here)
import people_cast as pc  # noqa: E402

_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(_args[0]) if _args else os.path.join(_here, "build", "people")
ASSETS = os.path.abspath(_args[1]) if len(_args) > 1 else "/run/media/dracky/e97d0aa9-5c45-460a-a682-b57cd6302030/Assets/People"

# ---------------------------------------------------------------- constants
VERSION = 1
RIG_DIRS = (("Models/Rig/Male", "M"), ("Models/Rig/Female", "F"), ("Extras_Rig/Male", "M"), ("Extras_Rig/Female", "F"))
TEXTURES = "Textures"
PEOPLE_VARIANTS = pc.PEOPLE_VARIANTS    # 12
WALK_KEYS = pc.WALK_KEYS                # 6 poses per cycle, stepped on the page (no blending)
ARM_HANG_DEG = 9.0                      # deg off vertical (outward) the arms hang at, clear of the hips
FACING = Matrix.Rotation(math.radians(-90), 4, "Z")   # pack faces Blender +X; glTF +Z is Blender -Y
ROUGHNESS, METALLIC = 0.85, 0.0
ATLAS_JPEG_QUALITY = 90                # the pack's textures are opaque; a PNG atlas alone is 3.4 MB
MATERIAL = "PEOPLE_Atlas"
PREFIX = "PEOPLE_"
B = "mixamorig:"
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def bones(arm):
    return arm.pose.bones


def turn(arm, name, axis, deg):
    """Rotate pose bone `name` by deg about the world axis through its head (children follow)."""
    bpy.context.view_layer.update()
    pb = bones(arm)[B + name]
    mw = arm.matrix_world
    world = mw @ pb.matrix
    pivot = world.translation.copy()
    rot = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-pivot)
    pb.matrix = mw.inverted() @ rot @ world


def aim(arm, name, target):
    """Rotate pose bone `name` (about its head) so its head->tail points along the world direction target."""
    bpy.context.view_layer.update()
    pb = bones(arm)[B + name]
    mw = arm.matrix_world
    world = mw @ pb.matrix
    d = (mw @ pb.tail - mw @ pb.head).normalized()
    pivot = world.translation.copy()
    q = d.rotation_difference(target.normalized()).to_matrix().to_4x4()
    pb.matrix = mw.inverted() @ Matrix.Translation(pivot) @ q @ Matrix.Translation(-pivot) @ world


def rest(arm):
    for pb in bones(arm):
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    # Arms down at the sides, straight: the walk adds the swing and the elbow bend.
    h = math.radians(ARM_HANG_DEG)
    for side, s in (("Left", 1), ("Right", -1)):
        down = Vector((0, s * math.sin(h), -math.cos(h)))
        aim(arm, side + "Arm", down)
        aim(arm, side + "ForeArm", down)


def pose(arm, phase):
    """walk_pose(phase) on the rig. Forward + for a leg/arm moves the foot/hand toward +X: about +Y that is
    a negative angle. Knee flex swings the shin back (+), elbow flex the hand forward (-)."""
    rest(arm)
    w = pc.walk_pose(phase)
    # Pelvis yaws toward the forward leg (left forward = left hip toward +X = negative about Z); the chest
    # takes twice the other way, so the shoulders turn against the hips.
    turn(arm, "Hips", Z, -w["twist"])
    turn(arm, "Spine1", Z, 2 * w["twist"])
    for side in ("Left", "Right"):
        j = w[side[0]]
        turn(arm, side + "UpLeg", Y, -j["thigh"])
        turn(arm, side + "Leg", Y, j["knee"])
        turn(arm, side + "Foot", Y, j["thigh"] - j["knee"])   # keep the foot at its rest pitch
        turn(arm, side + "Arm", Y, -j["arm"])
        turn(arm, side + "ForeArm", Y, -j["elbow"])
    bpy.context.view_layer.update()


def world_coords(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    co = co.reshape(-1, 3)
    m = np.array(FACING @ obj.matrix_world)
    return co @ m[:3, :3].T + m[:3, 3]


def image_name(mesh_obj):
    for m in mesh_obj.data.materials:
        for n in (m.node_tree.nodes if m and m.node_tree else []):
            if n.type == "TEX_IMAGE" and n.image:
                return n.image.name.rsplit(".", 1)[0] if n.image.name[-4:-3] == "." else n.image.name
    return mesh_obj.data.materials[0].name


def import_variant(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    meshes = [o for o in new if o.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"{path}: {len(meshes)} meshes")
    if arm.animation_data:
        arm.animation_data_clear()   # the 2-frame bind action would override the pose on every update
    return arm, meshes[0], new


def bake(v, tile, path):
    arm, src, new = import_variant(path)
    img = image_name(src)
    bpy.context.view_layer.update()
    hips = FACING @ (arm.matrix_world @ bones(arm)[B + "Hips"].bone.head_local)
    keys, hip_z, stride = [], [], 0.0
    for i, phase in enumerate(pc.key_phases()):
        pose(arm, phase)
        co = world_coords(src)
        co[:, 0] -= hips.x
        co[:, 1] -= hips.y
        ground = co[:, 2].min()
        co[:, 2] -= ground                  # lowest vertex on the ground: the hips bob, lowest at contact
        keys.append(co)
        hip_z.append((FACING @ (arm.matrix_world @ bones(arm)[B + "Hips"].head)).z - ground)
        if i == 0:   # contact: heel-to-heel along the walk (Blender -Y after FACING) = one step
            heel = {s: (FACING @ (arm.matrix_world @ bones(arm)[B + s + "Foot"].head)).y for s in ("Left", "Right")}
            stride = abs(heel["Left"] - heel["Right"])

    me = src.data.copy()
    me.name = PREFIX + v["name"]
    if me.shape_keys:
        raise RuntimeError(f"{path}: already has shape keys")
    me.vertices.foreach_set("co", keys[0].astype(np.float32).ravel())
    if "custom_normal" in me.attributes:   # the pack's split normals were for the bind pose
        me.attributes.remove(me.attributes["custom_normal"])
    uv = me.uv_layers.active.data
    flat = np.empty(len(uv) * 2, dtype=np.float64)
    uv.foreach_get("uv", flat)
    if flat.min() < -1e-4 or flat.max() > 1 + 1e-4:   # atlas_uv folds wrapped UVs, which would tear a face
        raise RuntimeError(f"{path}: UVs outside 0..1 ({flat.min():.3f}..{flat.max():.3f})")
    flat = np.array([c for u, w in flat.reshape(-1, 2) for c in pc.atlas_uv(u, w, tile)])
    uv.foreach_set("uv", flat)
    for name in [u.name for u in me.uv_layers if u != me.uv_layers.active]:
        me.uv_layers.remove(me.uv_layers[name])

    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    obj = bpy.data.objects.new(PREFIX + v["name"], me)
    bpy.context.scene.collection.objects.link(obj)
    obj.shape_key_add(name="Basis", from_mix=False)
    for i, co in enumerate(keys):
        kb = obj.shape_key_add(name=f"walk_{i}", from_mix=False)
        kb.data.foreach_set("co", co.astype(np.float32).ravel())
        kb.value = 0.0
    height = float(keys[0][:, 2].max())
    bob = max(hip_z) - min(hip_z)
    return obj, img, {"name": v["name"], "height": round(height, 4), "gender": v["gender"], "kind": v["kind"],
                      "tile": tile, "cycle_m": round(2 * stride, 4)}, bob


def atlas(images):
    T = pc.TILE_PX
    px = np.zeros((pc.ATLAS_ROWS * T, pc.ATLAS_COLS * T, 4), dtype=np.float32)
    px[..., 3] = 1.0
    for tile, name in enumerate(images):
        path = os.path.join(ASSETS, TEXTURES, name + ".png")
        im = bpy.data.images.load(path)
        if tuple(im.size) != (T, T):
            raise RuntimeError(f"{path}: {tuple(im.size)}, not {T}x{T}")
        a = np.empty(T * T * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        col, row = tile % pc.ATLAS_COLS, tile // pc.ATLAS_COLS
        px[row * T:(row + 1) * T, col * T:(col + 1) * T] = a.reshape(T, T, 4)
        bpy.data.images.remove(im)
    px = np.round(px * 255) / 255
    img = bpy.data.images.new("PEOPLE_atlas", pc.ATLAS_COLS * T, pc.ATLAS_ROWS * T, alpha=False)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.join(OUT_DIR, "people_atlas.jpg")
    img.file_format = "JPEG"
    bpy.context.scene.render.image_settings.quality = ATLAS_JPEG_QUALITY   # image.save() reads the scene's
    img.alpha_mode = "NONE"
    img.save()
    img.reload()
    return img


def material(img):
    m = bpy.data.materials.new(MATERIAL)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = ROUGHNESS
    bsdf.inputs["Metallic"].default_value = METALLIC
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    files = {}
    for sub, gender in RIG_DIRS:
        d = os.path.join(ASSETS, sub)
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            stem = os.path.splitext(f)[0]
            if f.lower().endswith(".fbx") and pc.allowed(stem):
                files.setdefault((gender, stem), os.path.join(d, f))   # Extras_Rig repeats Models/Rig files
    cast = pc.pick_variants(list(files))
    objs, images, meta, bobs = [], [], [], []
    for tile, v in enumerate(cast):
        obj, img, info, bob = bake(v, tile, files[(v["gender"], v["name"])])
        objs.append(obj); images.append(img); meta.append(info); bobs.append(bob)
        print(f"people: {obj.name} h {info['height']:.3f} cycle {info['cycle_m']:.3f} bob {bob * 100:.1f} cm "
              f"verts {len(obj.data.vertices)} tex {img}")
    mat = material(atlas(images))
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
    for m in [m for m in bpy.data.materials if m != mat]:
        bpy.data.materials.remove(m)
    for im in [im for im in bpy.data.images if im != mat.node_tree.nodes["Image Texture"].image]:
        bpy.data.images.remove(im)

    valid = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    opts = {"export_format": "GLB", "use_selection": False, "export_yup": True, "export_apply": False,
            "export_morph": True, "export_morph_normal": True, "export_morph_tangent": False,
            "export_try_sparse_sk": False, "export_skins": False, "export_animations": False,
            "export_materials": "EXPORT", "export_image_format": "AUTO", "export_texcoords": True,
            "export_normals": True, "export_extras": True, "export_cameras": False, "export_lights": False,
            "export_vertex_color": "NONE", "export_tangents": False}
    opts = {k: v for k, v in opts.items() if k in valid}
    glb = os.path.join(OUT_DIR, "people_raw.glb")
    bpy.ops.export_scene.gltf(filepath=glb, **opts)
    cycle = round(sum(m["cycle_m"] for m in meta) / len(meta), 3)
    out = {"version": VERSION, "keys": WALK_KEYS, "cycle_m": cycle, "variants": meta}
    with open(os.path.join(OUT_DIR, "people_meta.json"), "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"people: {glb} {os.path.getsize(glb)} bytes, cycle_m {cycle}, bob {min(bobs) * 100:.1f}-"
          f"{max(bobs) * 100:.1f} cm")


run()
