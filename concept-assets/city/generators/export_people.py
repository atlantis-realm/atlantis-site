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
  poses        five static poses after the walk (POSE_KEYS, people_cast.py): sit_pose seats the character on
               a ledge edge (thighs level or drooping, shins down, hands on the thighs; the thigh droop or shin
               tilt is solved so the seat lands SIT_SEAT_H above the soles), lean_pose stands it back to a
               wall (tilted LEAN_TILT back, right foot flat on the wall, hands in the pockets), lean_fwd_pose
               faces a railing (tipped and bent forward, forearms crossed on the rail top), stand_pose stands
               easy and talk_pose adds a right-arm gesture. The limbs are placed by two_bone IK, aim() and
               limb_dir(); measures in sit_measure / lean_measure / rail_measure.
  bake         each pose's deformed vertices (world space, turned to face -Y = glTF +Z, centred on the rest
               hips, lowest vertex on the ground) become shape keys walk_<i>, then POSE_KEYS; basis walk_0.
               The armature is deleted, so the glb holds plain meshes with WALK_KEYS + 5 morph targets. The
               ground lock gives the hip bob (lowest at contact) for free.
  atlas        the variants' 512 px textures (Textures/<image>.png) packed into ATLAS_COLS x ATLAS_ROWS tiles,
               UVs moved into each tile with an ATLAS_INSET_PX inset; one material PEOPLE_Atlas (roughness
               ROUGHNESS, metallic 0). The pack's colours are kept as they are.
  meta         people_meta.json {version, keys, poses: {sit: 6, lean: 7, lean_fwd: 8, stand: 9, talk: 10},
               cycle_m, variants: [{name, height, gender, kind, tile, cycle_m, sit_seat_h, sit_edge,
               sit_reach, lean_back, lean_fwd_front, lean_fwd_top}]}. keys = the walk
               keys only; poses = the morph target index of each static pose. cycle_m = 2 steps: twice the
               heel-to-heel stride at contact, the mean over the cast. All the sit/lean lengths are metres in
               the character's frame (origin = the mesh origin, forward = its facing): sit_seat_h = the seat
               contact above the soles, sit_edge = the ledge edge forward of the origin, sit_reach = the feet
               or knees forward of that edge, lean_back = the wall plane behind the origin, lean_fwd_front /
               lean_fwd_top = the forward lean's rail face ahead of the origin and its top above the soles.

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
VERSION = 3
RIG_DIRS = (("Models/Rig/Male", "M"), ("Models/Rig/Female", "F"), ("Extras_Rig/Male", "M"), ("Extras_Rig/Female", "F"))
TEXTURES = "Textures"
PEOPLE_VARIANTS = pc.PEOPLE_VARIANTS    # 12
WALK_KEYS = pc.WALK_KEYS                # 6 poses per cycle, stepped on the page (no blending)
POSE_KEYS = pc.POSE_KEYS                # ("sit", "lean", "lean_fwd", "stand", "talk"): targets WALK_KEYS + i
SIT_DROOP_MAX = 15.0                    # deg: most the thighs droop below level to raise the seat
SIT_SOLVE_STEPS = 16                    # bisection steps for the seat height (~0.05 deg)
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


def head(arm, name):
    bpy.context.view_layer.update()
    return arm.matrix_world @ bones(arm)[B + name].head


def tail(arm, name):
    bpy.context.view_layer.update()
    return arm.matrix_world @ bones(arm)[B + name].tail


def reach(arm, upper, lower, target, pole):
    """Two-bone IK: aim upper and lower (e.g. LeftArm, LeftForeArm) so lower's tail lands on target, the
    joint bending toward pole."""
    root, mid, end = head(arm, upper), head(arm, lower), tail(arm, lower)
    joint = Vector(pc.two_bone(tuple(root), tuple(target), (mid - root).length, (end - mid).length, tuple(pole)))
    aim(arm, upper, joint - root)
    aim(arm, lower, Vector(target) - joint)


def roll(arm, name, toward):
    """Turn hand `name` about its own axis so its thumb points as close to the world direction toward as it can."""
    thumb = name.replace("Hand", "HandThumb1")
    if B + thumb not in bones(arm):
        return
    h = head(arm, name)
    axis = (tail(arm, name) - h).normalized()
    cur = head(arm, thumb) - h
    cur, want = cur - axis * cur.dot(axis), toward - axis * toward.dot(axis)
    if cur.length < 1e-6 or want.length < 1e-6:
        return
    turn(arm, name, axis, math.degrees(math.atan2(axis.dot(cur.cross(want)), cur.dot(want))))


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


def sit_pose(arm, src, x):
    """Seated on a ledge edge. x > 0: thighs droop x deg below level, shins vertical; x < 0: thighs level,
    shins -x deg forward of vertical. The seat rises with x (sit_measure)."""
    rest(arm)
    droop, shin = math.radians(max(0.0, x)), math.radians(max(0.0, -x))
    for side, s in (("Left", 1), ("Right", -1)):
        foot = tail(arm, side + "Foot") - head(arm, side + "Foot")   # rest: the foot stays at its rest pitch
        thigh = (head(arm, side + "Leg") - head(arm, side + "UpLeg")).length
        aim(arm, side + "UpLeg", Vector((math.cos(droop), s * pc.SIT_KNEE_SPREAD / thigh, -math.sin(droop))))
        aim(arm, side + "Leg", Vector((math.sin(shin), 0, -math.cos(shin))))
        aim(arm, side + "Foot", foot)
    turn(arm, "Spine", Y, pc.SIT_SPINE_FWD)
    co = world_coords(src, facing=False)
    for side, s in (("Left", 1), ("Right", -1)):
        hip, knee = head(arm, side + "UpLeg"), head(arm, side + "Leg")
        p = hip.lerp(knee, pc.SIT_HAND_ALONG)
        near = (np.abs(co[:, 0] - p.x) < 0.04) & (np.abs(co[:, 1] - p.y) < 0.05)
        top = co[near, 2].max() if near.any() else p.z + 0.08
        # The wrist sits on the thigh's top, the elbow out and back; the hand lies along the thigh.
        reach(arm, side + "Arm", side + "ForeArm", Vector((p.x, p.y + s * 0.02, top + 0.02)), Vector((-0.6, s, 0)))
        aim(arm, side + "Hand", (knee - hip).normalized() + Vector((0, 0, -0.25)))
        roll(arm, side + "Hand", Vector((0, -s, 0)))   # palm down: the thumb inward
    bpy.context.view_layer.update()


def weighted_to(src, parts):
    """Mask of the vertices mostly weighted to one of the Left/Right `parts` bones (or a finger of a Hand)."""
    names = {s + b for s in ("Left", "Right") for b in parts}
    groups = {g.index for g in src.vertex_groups
              if g.name[len(B):] in names or any(g.name[len(B):].startswith(n) for n in names if n.endswith("Hand"))}
    return np.array([bool(v.groups) and max(v.groups, key=lambda g: g.weight).group in groups
                     for v in src.data.vertices])


def lower_legs(src):
    """Mask of the vertices mostly weighted to a shin, foot or toe bone."""
    return weighted_to(src, ("Leg", "Foot", "ToeBase", "Toe_End"))


def forearms(src):
    """Mask of the vertices mostly weighted to a forearm or hand (fingers too)."""
    return weighted_to(src, ("ForeArm", "Hand"))


def sit_measure(co, lower):
    """On baked sit coords (centred, grounded, facing -Y): the ledge edge SIT_EDGE_CLEAR behind the lower
    legs (shins and feet), the seat = the lowest point of the body behind it, so nothing behind the edge
    dips below the ledge top."""
    fwd, up = -co[:, 1], co[:, 2]
    edge = float(fwd[lower].min()) - pc.SIT_EDGE_CLEAR
    behind = (fwd < edge) & (np.abs(co[:, 0]) < 0.25)
    seat = float(up[behind].min())
    return {"sit_seat_h": seat, "sit_edge": edge, "sit_reach": float(fwd.max()) - edge}


def lean_pose(arm, src):
    """Back to a wall: tilted LEAN_TILT back about the hips, the left foot flat and level, the right foot's
    sole flat on the wall plane (the rearmost point of the upper body) at LEAN_FOOT_H, hands in the pockets."""
    rest(arm)
    feet = {side: tail(arm, side + "Foot") - head(arm, side + "Foot") for side in ("Left", "Right")}
    co = world_coords(src, facing=False)
    ankle_h = head(arm, "RightFoot").z - co[:, 2].min()   # ankle joint to sole, standing
    turn(arm, "Hips", Y, -pc.LEAN_TILT)
    for side in ("Left", "Right"):
        aim(arm, side + "Foot", feet[side])
    tilt = Matrix.Rotation(math.radians(-pc.LEAN_TILT), 3, "Y")
    fwd, up = tilt @ X, tilt @ Z
    co = world_coords(src, facing=False)
    for side, s in (("Left", 1), ("Right", -1)):
        hip = head(arm, side + "UpLeg")
        inset, out, down = pc.LEAN_POCKET
        z = hip.z - down
        # The pocket: the front of the thigh (or belly) at that height, measured on the mesh.
        band = (np.abs(co[:, 1] - hip.y) < 0.06) & (np.abs(co[:, 2] - z) < 0.04)
        front = co[band, 0].max() if band.any() else hip.x + 0.1
        reach(arm, side + "Arm", side + "ForeArm", Vector((front - inset, hip.y + s * out, z)), Vector((-0.2, s, 0)))
        aim(arm, side + "Hand", -up + fwd * 0.2)
        roll(arm, side + "Hand", fwd)   # palm to the thigh: the thumb forward
    co = world_coords(src, facing=False)
    ground = co[:, 2].min()
    wall = co[co[:, 2] > head(arm, "RightUpLeg").z - 0.25, 0].min()
    # The right foot: toes down (the rest foot pitched 90 deg), the sole on the wall, the knee forward.
    target = Vector((wall + ankle_h, head(arm, "RightUpLeg").y, ground + pc.LEAN_FOOT_H))
    reach(arm, "RightUpLeg", "RightLeg", target, Vector((1, 0, 0.3)))
    aim(arm, "RightFoot", Matrix.Rotation(math.radians(90), 3, "Y") @ feet["Right"])
    bpy.context.view_layer.update()


def relax_leg(arm, side, knee):
    """Bend side's knee by knee deg, the thigh forward half that, the foot back to level."""
    turn(arm, side + "UpLeg", Y, -knee / 2)
    turn(arm, side + "Leg", Y, knee)
    turn(arm, side + "Foot", Y, -knee / 2)


def lean_fwd_pose(arm):
    """Facing a railing: tipped LEAN_FWD_TILT forward about the hips (feet re-levelled), bent forward at the
    spine, the head up, the forearms crossing in front at rail height, palms down, the right knee relaxed.
    The rail is measured afterwards where the forearms land (rail_measure)."""
    rest(arm)
    feet = {side: tail(arm, side + "Foot") - head(arm, side + "Foot") for side in ("Left", "Right")}
    turn(arm, "Hips", Y, pc.LEAN_FWD_TILT)
    for side in ("Left", "Right"):
        aim(arm, side + "Foot", feet[side])
    for bone, deg in zip(("Spine", "Spine1", "Spine2"), pc.LEAN_FWD_SPINE):
        turn(arm, bone, Y, deg)
    turn(arm, "Neck", Y, pc.LEAN_FWD_NECK)
    for side, s in (("Left", 1), ("Right", -1)):
        aim(arm, side + "Arm", Vector(pc.limb_dir(*pc.LEAN_FWD_ARM, s)))
        aim(arm, side + "ForeArm", Vector(pc.limb_dir(*pc.LEAN_FWD_FOREARM, s)))
        aim(arm, side + "Hand", Vector(pc.limb_dir(*pc.LEAN_FWD_HAND, s)))
        roll(arm, side + "Hand", X)   # palm down on the rail: the thumb forward, the way the forearm crosses
    relax_leg(arm, "Right", pc.LEAN_FWD_KNEE)
    bpy.context.view_layer.update()


def stand_pose(arm):
    """Standing easy: arms down with the elbows a little bent, the weight on the left leg."""
    rest(arm)
    for side in ("Left", "Right"):
        turn(arm, side + "ForeArm", Y, -pc.STAND_ELBOW)
    relax_leg(arm, "Right", pc.STAND_KNEE)
    bpy.context.view_layer.update()


def talk_pose(arm):
    """stand_pose with the right arm out in front in a gesture, palm up, the head tipped to the right."""
    stand_pose(arm)
    aim(arm, "RightArm", Vector(pc.limb_dir(*pc.TALK_ARM, -1)))
    aim(arm, "RightForeArm", Vector(pc.limb_dir(*pc.TALK_FOREARM, -1)))
    aim(arm, "RightHand", Vector(pc.limb_dir(*pc.TALK_HAND, -1)))
    roll(arm, "RightHand", Vector((0, -1, 0)))   # palm up: the thumb outward
    turn(arm, "Head", X, pc.TALK_HEAD)
    bpy.context.view_layer.update()


def lean_measure(co):
    return {"lean_back": float(co[:, 1].max())}   # facing -Y: the rearmost point is the largest y


def world_coords(obj, facing=True):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    co = co.reshape(-1, 3)
    m = np.array(FACING @ obj.matrix_world if facing else obj.matrix_world)
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

    def grounded():
        co = world_coords(src)
        co[:, 0] -= hips.x
        co[:, 1] -= hips.y
        co[:, 2] -= co[:, 2].min()
        return co

    lower = lower_legs(src)

    def seat(x):
        sit_pose(arm, src, x)
        return sit_measure(grounded(), lower)["sit_seat_h"]

    x = pc.solve_increasing(seat, -pc.SIT_SHIN_MAX, SIT_DROOP_MAX, pc.SIT_SEAT_H, SIT_SOLVE_STEPS)
    sit_pose(arm, src, x)
    keys.append(grounded())
    sit = sit_measure(keys[-1], lower)
    lean_pose(arm, src)
    keys.append(grounded())
    lean = lean_measure(keys[-1])
    lean_fwd_pose(arm)
    keys.append(grounded())
    ground = world_coords(src)[:, 2].min()
    joints = min((FACING @ head(arm, side + b)).z for side in ("Left", "Right") for b in ("ForeArm", "Hand"))
    fwd = pc.rail_measure(keys[-1], forearms(src), joints - ground)
    if fwd["lean_fwd_clear"] < 0:
        raise RuntimeError(f"{path}: the forward lean's body crosses the rail by {-fwd['lean_fwd_clear']:.3f} m")
    stand_pose(arm)
    keys.append(grounded())
    talk_pose(arm)
    keys.append(grounded())

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
    names = [f"walk_{i}" for i in range(WALK_KEYS)] + list(POSE_KEYS)
    for name, co in zip(names, keys):
        kb = obj.shape_key_add(name=name, from_mix=False)
        kb.data.foreach_set("co", co.astype(np.float32).ravel())
        kb.value = 0.0
    height = float(keys[0][:, 2].max())
    bob = max(hip_z) - min(hip_z)
    return obj, img, {"name": v["name"], "height": round(height, 4), "gender": v["gender"], "kind": v["kind"],
                      "tile": tile, "cycle_m": round(2 * stride, 4),
                      **{k: round(v, 4) for k, v in {**sit, **lean, **fwd}.items() if k != "lean_fwd_clear"},
                      "sit_x": x, "fwd_clear": fwd["lean_fwd_clear"]}, bob


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
        x, clear = info.pop("sit_x"), info.pop("fwd_clear")
        print(f"people: {obj.name} h {info['height']:.3f} cycle {info['cycle_m']:.3f} bob {bob * 100:.1f} cm "
              f"verts {len(obj.data.vertices)} tex {img}; sit {'droop' if x > 0 else 'shin'} {abs(x):.1f} deg "
              f"seat {info['sit_seat_h']:.3f} edge {info['sit_edge']:.3f} reach {info['sit_reach']:.3f}, "
              f"lean_back {info['lean_back']:.3f}; lean_fwd front {info['lean_fwd_front']:.3f} top "
              f"{info['lean_fwd_top']:.3f} clear {clear:.3f}")
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
    out = {"version": VERSION, "keys": WALK_KEYS, "poses": {k: WALK_KEYS + i for i, k in enumerate(POSE_KEYS)},
           "cycle_m": cycle, "variants": meta}
    with open(os.path.join(OUT_DIR, "people_meta.json"), "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"people: {glb} {os.path.getsize(glb)} bytes, cycle_m {cycle}, bob {min(bobs) * 100:.1f}-"
          f"{max(bobs) * 100:.1f} cm")


if __name__ == "__main__":
    run()
