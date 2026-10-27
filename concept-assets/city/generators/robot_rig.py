"""Variant roll, bone pruning and walk measures for the /city robot export (export_robot.py). Pure Python, no bpy.

roll_variants()   K seeded, distinct robots: a body set per slot (mostly one main set, a slot or two from
                  another), and one or two mirrored pairs of armour/modules on the limbs, maybe a jetpack.
slot_parts()      a variant's mesh parts: each slot's part from its set and every shared Core_* part.
socket_bone()     the attachment socket bone for a slot's set size (Shoulder_M_Attachment.L, Back_S_Attachment).
is_weapon()       guns, missiles, weapon carriers and melee weapons: never rolled (a civic city).
keep_bones()      the bones the baked rig keeps: the ones the parts are weighted to and their ancestors.
lowest_contact()  which frames a foot is on the ground: within eps of its lowest height over the loop.
stance_cycle_m()  ground covered per walk loop, from how fast the planted feet slide back in an in-place walk.
skate_m()         how far a planted foot drifts against the ground at a given cycle_m (the worst contact run).

Tests: python3 -m unittest discover -s test -p "test_*.py"
"""
import random

# The six body sets: Base_ in Mech_Char_Mesh.fbx, Base(A)_ in the Mech_00A.fbx expansion; the letter before
# the last _ is the size the attachment sockets come in (S, M, L).
SETS = ("Base_S_", "Base_M_", "Base_L_", "Base(A)_S_", "Base(A)_M_", "Base(A)_L_")
SLOTS = ("Torso", "Pelvis", "Shoulder", "Arm", "Forearm", "Thigh", "Leg")   # Forearm is a .L and a .R mesh
CORE = "Core_"
WEAPONS = ("Gun", "Missile", "Weapon", "Sword", "Hammer")   # LimbGun forearms, Attach_Gun_*, Attach_Back_*Gun ...
# The socket size follows the slot it sits on (as the pack's prefabs mostly do).
SOCKET_SLOT = {"Back": "Torso", "Shoulder": "Shoulder", "Elbow": "Forearm", "Thigh": "Thigh", "Knee": "Leg"}
ARMOUR = ("Attach_Armour_00", "Attach_Armour_01", "Attach_Armour_02")
MODULES = ("Attach_Module_00", "Attach_Module_02")   # not _01: a thin cage that reads as noise at a distance
# Which items each mirrored limb socket takes (the prefabs: modules on shoulders and thighs, armour anywhere).
ATTACH_FITS = {"Shoulder": ARMOUR + MODULES, "Elbow": ARMOUR, "Thigh": ARMOUR + MODULES, "Knee": ARMOUR}
BACK_ITEMS = ("Attach_Back_JetPack_00",)
BACK_CHANCE = 0.4      # of a jetpack
MIX_SLOTS = (0, 1, 1, 2)   # slots taken from another set: one of these, at random
LIMB_PAIRS = (1, 2)        # mirrored limb attachment pairs: one of these, at random
ROLL_TRIES = 500


def is_weapon(name):
    return any(w in name for w in WEAPONS)


def slot_parts(names, slots):
    """slots: {slot: set prefix}. The slots' parts and the core parts, sorted; KeyError if one is missing."""
    have = set(names)
    want = []
    for slot in SLOTS:
        want += [slots[slot] + slot + s for s in (".L", ".R")] if slot == "Forearm" else [slots[slot] + slot]
    for n in want:
        if n not in have:
            raise KeyError(n)
    return sorted(want + [n for n in have if n.startswith(CORE) and not is_weapon(n)])


def socket_bone(kind, side, slots):
    """kind: a SOCKET_SLOT key, side: '.L', '.R' or '' (Back)."""
    return f"{kind}_{slots[SOCKET_SLOT[kind]][-2]}_Attachment{side}"


def roll_variants(names, tris, k, seed, max_tris):
    """k distinct variants from random.Random(seed). names: the pack's mesh names; tris: {mesh or attachment
    name: triangles}. Each variant's main set comes round a shuffled SETS, so k >= 6 uses every set.
    Returns [{name, main, slots, parts, attachments: [(item, socket bone)] sorted, tris}]."""
    rng = random.Random(seed)
    mains = list(SETS)
    rng.shuffle(mains)
    out, seen = [], set()
    for i in range(k):
        main = mains[i % len(mains)]
        for _ in range(ROLL_TRIES):
            slots = {s: main for s in SLOTS}
            for _ in range(rng.choice(MIX_SLOTS)):
                slots[rng.choice(SLOTS)] = rng.choice([x for x in SETS if x != main])
            att = []
            for kind in rng.sample(sorted(ATTACH_FITS), rng.choice(LIMB_PAIRS)):
                item = rng.choice(ATTACH_FITS[kind])
                att += [(item, socket_bone(kind, side, slots)) for side in (".L", ".R")]
            if rng.random() < BACK_CHANCE:
                att.append((rng.choice(BACK_ITEMS), socket_bone("Back", "", slots)))
            att.sort()
            parts = slot_parts(names, slots)
            total = sum(tris[n] for n in parts) + sum(tris[a] for a, _ in att)
            sig = (tuple(sorted(slots.items())), tuple(att))
            if total <= max_tris and sig not in seen:
                break
        else:
            raise ValueError(f"no new variant within {max_tris} triangles after {ROLL_TRIES} rolls")
        seen.add(sig)
        out.append({"name": f"ROBOT_V{i}", "main": main, "slots": slots, "parts": parts, "attachments": att,
                    "tris": total})
    return out


def keep_bones(parents, weighted):
    """parents: {bone: parent or None}. The weighted bones and every ancestor, so the hierarchy stays whole."""
    keep = set()
    for b in weighted:
        if b not in parents:
            raise KeyError(b)
        while b is not None and b not in keep:
            keep.add(b)
            b = parents[b]
    return keep


def lowest_contact(z, eps):
    lo = min(z)
    return [h <= lo + eps for h in z]


def stance_cycle_m(feet, eps):
    """feet: [(z, fwd)] per foot, one sample per frame over the loop, the last sample = the first. fwd is
    the coordinate along the facing. A planted foot in an in-place walk slides back at the ground speed, so
    the mean backward step over neighbouring frames both on the ground, times the loop's frames, is the
    distance one loop covers without the feet skating."""
    total, pairs, frames = 0.0, 0, None
    for z, fwd in feet:
        frames = len(z) - 1
        down = lowest_contact(z, eps)
        for i in range(frames):
            if down[i] and down[i + 1]:
                total += fwd[i] - fwd[i + 1]
                pairs += 1
    if not pairs:
        raise ValueError("no frames with a foot on the ground")
    return total / pairs * frames


def skate_m(feet, eps, cycle_m):
    """The largest spread of a planted foot's position against ground moving at cycle_m per loop, over each
    run of contact frames (same feet format as stance_cycle_m). 0 = no skating."""
    worst = 0.0
    for z, fwd in feet:
        frames = len(z) - 1
        v = cycle_m / frames
        down = lowest_contact(z, eps)
        run = []
        for i in range(frames + 1):
            if down[i]:
                run.append(fwd[i] + v * i)
            if not down[i] or i == frames:
                if len(run) > 1:
                    worst = max(worst, max(run) - min(run))
                run = []
    return worst
