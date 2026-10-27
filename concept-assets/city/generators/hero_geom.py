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
gl_heading()       glTF yaw of a Blender facing direction (walkerPose's convention).
polyline_dist()    horizontal distance from a point to a path.
thin_spots()       greedy minimum spacing, first come first kept.
stride_pick()      an even, deterministic subset.
sit_profile()      the drop in front of a ledge, from downward probes behind and in front of its edge.
lean_profile()     whether the ground in front of a wall is level and free.

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


def gl_heading(fx, fy):
    """Heading of a horizontal Blender facing (fx, fy): the yaw about glTF +Y turning local +Z to it.

    glTF is (x, z, -y) of Blender, so the facing is glTF (fx, 0, -fy); the same atan2(dx, dz) as
    walkerPose in src/lib/city/people.ts.
    """
    return math.atan2(fx, -fy)


def polyline_dist(p, path):
    """Distance in x, y from p to the polyline `path` ((x, y, ...) points); inf for an empty path."""
    if not path:
        return math.inf
    if len(path) == 1:
        return math.hypot(p[0] - path[0][0], p[1] - path[0][1])
    best = math.inf
    for a, b in zip(path, path[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        ll = dx * dx + dy * dy
        t = 0.0 if ll == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll))
        best = min(best, math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
    return best


def thin_spots(points, min_dist):
    """Indices of the points kept, in order, when each is dropped if it lies closer than `min_dist`
    (in x, y) to one kept before it."""
    kept, out = [], []
    m2 = min_dist * min_dist
    for i, p in enumerate(points):
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 >= m2 - 1e-12 for q in kept):
            kept.append(p)
            out.append(i)
    return out


def stride_pick(items, n):
    """At most n items spread evenly over the list, first and last included; the list itself if short."""
    if len(items) <= n:
        return list(items)
    if n <= 1:
        return list(items[:n])
    return [items[round(k * (len(items) - 1) / (n - 1))] for k in range(n)]


def sit_profile(top, behind, front, drop_range, tol):
    """The drop (m) in front of a ledge whose top is at `top`, or None if it is no seat.

    `behind`: ledge-top heights probed behind the edge (the seat), all within `tol` of `top`.
    `front`: ground heights probed in front of it (under the knees and feet), level within `tol` of the
    first. The drop is top minus the first front height and must lie in `drop_range`. None in a list is
    a probe that hit nothing.
    """
    if any(z is None for z in behind) or not front or any(z is None for z in front):
        return None
    if any(abs(z - top) > tol for z in behind):
        return None
    if any(abs(z - front[0]) > tol for z in front):
        return None
    drop = top - front[0]
    return drop if drop_range[0] <= drop <= drop_range[1] else None


def lean_profile(ground_z, front, tol):
    """True if every ground probe in front of a wall (None = no hit) is within `tol` of `ground_z`."""
    return all(z is not None and abs(z - ground_z) <= tol for z in front)
