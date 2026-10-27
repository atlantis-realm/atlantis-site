"""Part pick, bone pruning and walk measures for the /city robot export (export_robot.py). Pure Python, no bpy.

pick_parts()      the mesh parts to build the robot from: the medium body set (Base_M_*) with the plain
                  forearms (no LimbGun: the Core_Palm hands go with them) and every shared Core_* part.
keep_bones()      the bones the baked rig keeps: the ones the parts are weighted to and their ancestors.
lowest_contact()  which frames a foot is on the ground: within eps of its lowest height over the loop.
stance_cycle_m()  ground covered per walk loop, from how fast the planted feet slide back in an in-place walk.
skate_m()         how far a planted foot drifts against the ground at a given cycle_m (the worst contact run).

Tests: python3 -m unittest discover -s test -p "test_*.py"
"""

BODY_SET = "Base_M_"
CORE = "Core_"
EXCLUDE = ("LimbGun",)   # gun forearms; mutually exclusive with Core_Palm.L/R


def pick_parts(names):
    return sorted(n for n in names
                  if (n.startswith(BODY_SET) or n.startswith(CORE)) and not any(x in n for x in EXCLUDE))


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
