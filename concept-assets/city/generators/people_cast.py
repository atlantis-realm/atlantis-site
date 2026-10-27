"""Cast, walk curves and atlas maths for the /city people export (export_people.py). Pure Python, no bpy.

allowed()        a pack file may be used: never a Killer, Monster or Exotic_dancer model.
uniform_kind()   Police, Firefighter, Doctor, HM (hazmat), Sheriff, or None for a civilian.
pick_variants()  the PEOPLE_VARIANTS cast from the pack's rigged files, a fixed stride rule (no randomness),
                 so reruns pick the same people whatever order the folders list in.
walk_pose()      joint angles (degrees) at a walk phase 0..1; key_phases() are the WALK_KEYS baked phases.
two_bone()       the elbow/knee point of a two-bone limb reaching a target (the sit and lean poses).
solve_increasing() bisection for the input of an increasing function that gives a target value.
atlas_uv()       a variant's UV moved into its tile of the shared atlas, inset so mips don't bleed.

Tests: python3 -m unittest discover -s test -p "test_*.py"
"""
import math
import re

PEOPLE_VARIANTS = 12
# Uniform slots, in order: (gender, kind). The rest of the cast is civilians, half men and half women.
UNIFORM_SLOTS = (("M", "Police"), ("F", "Firefighter"), ("M", "Doctor"), ("F", "HM"))
UNIFORM_KINDS = ("Police", "Firefighter", "Doctor", "HM", "Sheriff")
EXCLUDE = re.compile(r"Killer|Monster|Exotic", re.I)

# Walk: WALK_KEYS poses per cycle (2 steps), stepped on the page with no blending between them: the chunky
# 6-frame look is intended (the robots added later are the fluid ones). Phase 0 = left heel contact.
WALK_KEYS = 6
THIGH_SWING = 23.0      # deg: upper legs swing +-this (forward +); 23 gives a ~1.45 m cycle
KNEE_STANCE = 5.0       # deg: knee flex at all times
KNEE_LOAD = 24.0        # deg: extra flex in early stance (loading, thigh still forward): flattens the hip bob
KNEE_SWING = 45.0       # deg: extra knee flex at the swing leg's passing pose
ARM_SWING = 18.0        # deg: arms counter-swing +-this (forward +)
ELBOW_BASE = 12.0       # deg: elbow flex at all times
ELBOW_SWING = 14.0      # deg: extra elbow flex with the arm forward
SPINE_TWIST = 6.0       # deg: shoulders turn against the hips (about the vertical)

# Static poses, baked as morph targets after the walk keys (walk_0..walk_5, then these): POSE_KEYS[i] is
# target WALK_KEYS + i. The page holds them still (one key at 1), like the walk with no blending.
POSE_KEYS = ("sit", "lean")
# Sit: on a ledge edge, thighs level (knees SIT_KNEE_SPREAD m apart each side of the hips' line), shins
# down, tilted forward as needed so the seat lands SIT_SEAT_H above the soles; back SIT_SPINE_FWD forward.
SIT_SEAT_H = 0.45       # m: target seat contact above the feet (short people get what vertical shins give)
SIT_SHIN_MAX = 35.0     # deg: most the shins tilt forward of vertical to bring the seat down
SIT_KNEE_SPREAD = 0.04  # m: each knee out from its hip's line
SIT_SPINE_FWD = 6.0     # deg: upper body forward of upright
SIT_HAND_ALONG = 0.6    # hands on the thighs, this far from hip to knee
SIT_EDGE_CLEAR = 0.03   # m: the ledge edge this far behind the calves (so the shins clear its face)
# Lean: back to a wall, body tilted LEAN_TILT back, the right foot flat against the wall at LEAN_FOOT_H,
# hands in the front pockets.
LEAN_TILT = 7.0         # deg: whole body back from vertical, pivoting on the standing foot
LEAN_FOOT_H = 0.42      # m: the raised (right) ankle above the ground
LEAN_POCKET = (0.03, 0.04, 0.08)    # m: wrist inside the thigh's front, out from the hip joint, below it

# Atlas: one 512 px tile per variant.
TILE_PX = 512
ATLAS_COLS, ATLAS_ROWS = 4, 3
ATLAS_INSET_PX = 4      # px each side of a tile kept clear of UVs, so lower mips don't pull in the neighbour


def allowed(name):
    return not EXCLUDE.search(name)


def uniform_kind(name):
    for kind in UNIFORM_KINDS:
        if re.search(rf"(^|_){kind}(_|$)", name):
            return kind
    return None


def _stride(items, k):
    """k items spread evenly over a sorted list, from the middle of each of k equal runs."""
    n = len(items)
    return [items[(2 * i + 1) * n // (2 * k)] for i in range(min(k, n))]


def pick_variants(pool, count=PEOPLE_VARIANTS, uniform_slots=UNIFORM_SLOTS):
    """pool: (gender 'M'/'F', file stem) pairs, duplicates allowed. Returns [{name, gender, kind}] sorted
    by name: one of each uniform slot (the first file of that kind and gender), then civilians by stride."""
    seen = sorted({(g, n) for g, n in pool if allowed(n)}, key=lambda p: (p[1], p[0]))
    cast = []
    for gender, kind in uniform_slots:
        match = [n for g, n in seen if g == gender and uniform_kind(n) == kind]
        if match:
            cast.append({"name": match[0], "gender": gender, "kind": kind})
    civilians = count - len(cast)
    for gender, k in (("M", civilians - civilians // 2), ("F", civilians // 2)):
        # Men get the odd one if there is one; the uniform slots are balanced M/F already.
        names = [n for g, n in seen if g == gender and uniform_kind(n) is None]
        cast += [{"name": n, "gender": gender, "kind": None} for n in _stride(names, k)]
    return sorted(cast, key=lambda v: v["name"])


def key_phases(keys=WALK_KEYS):
    return [i / keys for i in range(keys)]


def _side(p):
    c, s = math.cos(2 * math.pi * p), math.sin(2 * math.pi * p)
    arm = -ARM_SWING * c
    return {
        "thigh": THIGH_SWING * c,
        # Swing (0.5-1, forward): bends most at passing. Early stance (0-0.25): the loading bend, which
        # lowers the hips where the leg is nearly upright; late stance stays straight.
        "knee": KNEE_STANCE + KNEE_SWING * max(0.0, -s) + (KNEE_LOAD * math.sin(4 * math.pi * p) if p < 0.25 else 0.0),
        "arm": arm,
        "elbow": ELBOW_BASE + ELBOW_SWING * max(0.0, arm / ARM_SWING),
    }


def walk_pose(phase):
    """Angles in degrees at phase 0..1. L/R: thigh and arm forward +, knee and elbow flex +. twist: the
    pelvis yaw toward the forward leg (the chest takes -2x it, so the shoulders turn the other way)."""
    p = phase % 1.0
    return {"L": _side(p), "R": _side((p + 0.5) % 1.0), "twist": SPINE_TWIST * math.cos(2 * math.pi * p)}


def _sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def two_bone(root, target, l1, l2, pole):
    """Joint point (elbow or knee) of a limb root -> joint -> end with segment lengths l1, l2 whose end
    reaches target, bending toward the pole direction. Out of reach, the limb points straight at target."""
    d_vec = _sub(target, root)
    d = math.sqrt(_dot(d_vec, d_vec))
    u = tuple(x / d for x in d_vec)
    d = min(max(d, abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6)
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    w = _sub(pole, tuple(x * _dot(pole, u) for x in u))   # the pole without its along-limb part
    n = math.sqrt(_dot(w, w)) or 1.0
    return tuple(r + a * ui + h * wi / n for r, ui, wi in zip(root, u, w))


def solve_increasing(f, lo, hi, target, steps=40):
    """x in [lo, hi] with f(x) = target for an increasing f, clamped to the ends."""
    if f(lo) >= target:
        return lo
    if f(hi) <= target:
        return hi
    for _ in range(steps):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if f(mid) < target else (lo, mid)
    return (lo + hi) / 2


def _fold(t):
    return t if 0.0 <= t <= 1.0 else t - math.floor(t)


def atlas_uv(u, v, tile, cols=ATLAS_COLS, rows=ATLAS_ROWS, inset_px=ATLAS_INSET_PX, tile_px=TILE_PX):
    """(u, v) of a 0..1 texture into tile `tile` (row-major from the bottom-left, Blender UV space)."""
    col, row = tile % cols, tile // cols
    inset = inset_px / tile_px
    span = 1.0 - 2 * inset
    return ((col + inset + _fold(u) * span) / cols, (row + inset + _fold(v) * span) / rows)
