"""Cull geometry for the /city hero export (export_hero.py). Pure Python, no bpy/mathutils.

Vectors are plain (x, y, z) tuples in Blender world space (Z up). Planes are (nx, ny, nz, d) with
the normal pointing into the frustum: a point p is inside a plane when n.p + d >= 0.

frustum_planes()   the 6 planes of a perspective camera, optionally widened by a margin.
aabb_in_frustum()  conservative box test: false only when the box is fully outside one plane.
safe_vfov()        the safe-frame rule: narrow screens widen the vertical FOV to keep the safe
                   frame's width in view. Same rule as safeFrameFov in src/lib/city/heroCamera.ts.
cull_aspects()     the screen aspects the export culls for, with their safe-frame vfov.
sample_frames()    the camera frames the cull samples.
clear_runs()       split a walk path round the points it must avoid (near the camera).

Tests: python3 -m unittest discover -s test -p "test_*.py"
"""
import math

# Screen aspects the hero must work at: the Blender shot, ultrawide, and a tall phone in portrait.
CULL_ASPECTS = (16 / 9, 21 / 9, 9 / 19.5)
# The narrowest culled aspect. Narrower screens use its FOV (they see a little less width, never past
# the culled frusta). Same as MIN_ASPECT in src/lib/city/heroCamera.ts.
MIN_ASPECT = min(CULL_ASPECTS)
# Hero camera move (Camera.001) and how often the cull samples it.
FRAME_START, FRAME_END, FRAME_STEP = 1, 250, 5


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    length = math.sqrt(_dot(a, a))
    return (a[0] / length, a[1] / length, a[2] / length)


def _comb(s, a, t, b):
    """s*a + t*b"""
    return (s * a[0] + t * b[0], s * a[1] + t * b[1], s * a[2] + t * b[2])


def _plane(n, through):
    return (n[0], n[1], n[2], -_dot(n, through))


def frustum_planes(pos, fwd, up, vfov_rad, aspect, near, far, margin=0.0):
    """6 inward-facing planes (near, far, left, right, bottom, top) of a perspective camera.

    `fwd` is the view direction, `up` any vector not parallel to it (re-orthogonalised here).
    `aspect` is width/height; the horizontal FOV follows from vfov and aspect. `margin` widens
    both the vertical and horizontal FOV by that many radians (half on each side).
    """
    f = _norm(fwd)
    right = _norm(_cross(f, up))
    u = _cross(right, f)
    half_v = vfov_rad / 2 + margin / 2
    half_h = math.atan(math.tan(vfov_rad / 2) * aspect) + margin / 2

    near_pt = _comb(1, pos, near, f)
    far_pt = _comb(1, pos, far, f)
    sh, ch = math.sin(half_h), math.cos(half_h)
    sv, cv = math.sin(half_v), math.cos(half_v)
    return [
        _plane(f, near_pt),
        _plane((-f[0], -f[1], -f[2]), far_pt),
        _plane(_comb(ch, right, sh, f), pos),  # left
        _plane(_comb(-ch, right, sh, f), pos),  # right
        _plane(_comb(cv, u, sv, f), pos),  # bottom
        _plane(_comb(-cv, u, sv, f), pos),  # top
    ]


def aabb_in_frustum(lo, hi, planes):
    """True unless the box (lo, hi corners) lies fully outside some plane.

    Conservative: a box near a frustum corner can be outside every view yet still count as in,
    which only ever keeps extra geometry, never drops visible geometry.
    """
    for nx, ny, nz, d in planes:
        # The box corner furthest along the normal.
        px = hi[0] if nx >= 0 else lo[0]
        py = hi[1] if ny >= 0 else lo[1]
        pz = hi[2] if nz >= 0 else lo[2]
        if nx * px + ny * py + nz * pz + d < 0:
            return False
    return True


def safe_vfov(aspect, base_vfov, safe_half_tan):
    """Vertical FOV (radians) that keeps the safe frame's width in view.

    `base_vfov` is the camera's vertical FOV at 16:9; `safe_half_tan` is tan of half the horizontal
    angle that must stay visible. Narrow screens widen the vertical FOV; 16:9 and wider keep
    `base_vfov`.

    Same rule as `safeFrameFov` in src/lib/city/heroCamera.ts (which works in degrees); the site
    uses that one at runtime, so keep the two formulas identical.
    Aspects narrower than MIN_ASPECT are treated as MIN_ASPECT, so no screen sees past the culled frusta.
    """
    return max(base_vfov, 2 * math.atan(safe_half_tan / max(aspect, MIN_ASPECT)))


def cull_aspects(base_vfov, safe_half_tan):
    """[(aspect, vfov)] for each of CULL_ASPECTS under the safe-frame rule."""
    return [(a, safe_vfov(a, base_vfov, safe_half_tan)) for a in CULL_ASPECTS]


def sample_frames(start=FRAME_START, end=FRAME_END, step=FRAME_STEP):
    """Frames from start to end every `step`, always including both ends, strictly increasing."""
    frames = list(range(start, end + 1, step))
    if frames[-1] != end:
        frames.append(end)
    return frames


def clear_runs(points, closed, ok):
    """The runs of consecutive points with ok(point) true, each at least 2 points long.

    A closed path (the last segment joins the last point back to the first) with every point ok
    comes back as one run with its first point repeated at the end, still a closed loop. With any
    point dropped it is cut there and walked round from just after the cut, so the arc that
    crosses the path's start stays in one piece. Runs are lists of the original points, in order.
    """
    flags = [bool(ok(p)) for p in points]
    if all(flags):
        return [list(points) + list(points[:1])] if closed and points else ([list(points)] if points else [])
    if closed:
        k = flags.index(False) + 1
        points, flags = list(points[k:]) + list(points[:k]), flags[k:] + flags[:k]
    runs, cur = [], []
    for p, f in zip(points, flags):
        if f:
            cur.append(p)
        else:
            if len(cur) >= 2:
                runs.append(cur)
            cur = []
    if len(cur) >= 2:
        runs.append(cur)
    return runs
