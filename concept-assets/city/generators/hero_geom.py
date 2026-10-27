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
side_dirs()        the two horizontal directions square to a facing; side_points() the points either side.
walk_run()         the run of walkable ground heights round a point of a line (robot routes).
bands()            the runs of true flags at least a given length (cross streets along the avenue).
ring_crossing()    where a ray first meets a circle (a ring avenue across the hero avenue).
arc_lengths()      cumulative x, y length along a polyline.
seen_ranges()      per frame, the arc-length range of the points seen from it.
wall_top()         the height of a wall or railing top from rays scanned up its face.
disc_offsets()     the grid cells within a radius (flat ground for a conversation circle).
pool_max()         the highest sample (and box top) per cell of a coarse grid (the drones' sky heights).
flat_patch()       whether a height map cell and its neighbours are one level (a drone's roof drop).

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


def side_dirs(fx, fy):
    """The two horizontal unit directions square to the facing (fx, fy): its left, then its right."""
    n = math.hypot(fx, fy)
    return (-fy / n, fx / n), (fy / n, -fx / n)


def side_points(p, face, off):
    """The points `off` to the left and right of p (x, y), square to the facing `face` (x, y)."""
    return [(p[0] + sx * off, p[1] + sy * off) for sx, sy in side_dirs(*face)]


def walk_run(zs, i, max_step):
    """(first, last) indices of the run of `zs` round index i a walker can follow: no None (blocked) and no
    step between neighbours higher than `max_step`. None if zs[i] itself is blocked."""
    if zs[i] is None:
        return None
    a = b = i
    while a > 0 and zs[a - 1] is not None and abs(zs[a - 1] - zs[a]) <= max_step:
        a -= 1
    while b + 1 < len(zs) and zs[b + 1] is not None and abs(zs[b + 1] - zs[b]) <= max_step:
        b += 1
    return a, b


def bands(flags, min_len):
    """(first, last) indices of each run of true flags at least `min_len` long, in order."""
    out, start = [], None
    for k, f in enumerate(list(flags) + [False]):
        if f and start is None:
            start = k
        elif not f and start is not None:
            if k - start >= min_len:
                out.append((start, k - 1))
            start = None
    return out


def ring_crossing(o, d, c, r):
    """Smallest t >= 0 with |o + t d - c| = r in x, y (`d` a unit vector), or None if the ray misses the circle."""
    px, py = o[0] - c[0], o[1] - c[1]
    b = px * d[0] + py * d[1]
    disc = b * b - (px * px + py * py - r * r)
    if disc < 0:
        return None
    for t in (-b - math.sqrt(disc), -b + math.sqrt(disc)):
        if t >= 0:
            return t
    return None


def arc_lengths(points):
    """Cumulative x, y distance from the first point to each point of a polyline."""
    out, acc = [], 0.0
    for k, p in enumerate(points):
        if k:
            acc += math.hypot(p[0] - points[k - 1][0], p[1] - points[k - 1][1])
        out.append(acc)
    return out


def seen_ranges(ts, per_frame):
    """[[frame, t_lo, t_hi]] for each (frame, flags) of `per_frame` with some flag set: the range of the
    arc lengths `ts` of the points seen from that frame. Frames seeing nothing are left out."""
    out = []
    for frame, flags in per_frame:
        seen = [t for t, f in zip(ts, flags) if f]
        if seen:
            out.append([frame, min(seen), max(seen)])
    return out


def wall_top(hs, hits):
    """The first height of `hs` (rising) whose ray toward a wall missed it, after the ray at hs[0] (the contact)
    hit: the wall or railing top lies just below it. None if the contact ray missed or every ray hit (a tall wall)."""
    if not hits or not hits[0]:
        return None
    for h, hit in zip(hs, hits):
        if not hit:
            return h
    return None


def disc_offsets(r, step):
    """Integer (di, dj) grid offsets (cells `step` apart) within `r` of the centre cell, sorted."""
    n = int(r / step)
    return sorted((di, dj) for di in range(-n, n + 1) for dj in range(-n, n + 1)
                  if math.hypot(di, dj) * step <= r + 1e-9)


def pool_max(points, origin, cell, nx, ny, empty, boxes=()):
    """Per cell of an nx x ny grid of `cell` squares from `origin` (x, y), row-major (y then x): the highest
    `h` of the (x, y, h) points in it and of the ((x0, y0), (x1, y1), h) boxes overlapping it, else `empty`.
    Points off the grid are ignored."""
    out = [empty] * (nx * ny)
    for x, y, h in points:
        i, j = math.floor((x - origin[0]) / cell), math.floor((y - origin[1]) / cell)
        if 0 <= i < nx and 0 <= j < ny and h > out[j * nx + i]:
            out[j * nx + i] = h
    for (x0, y0), (x1, y1), h in boxes:
        i0, i1 = max(0, math.floor((x0 - origin[0]) / cell)), min(nx - 1, math.floor((x1 - origin[0]) / cell))
        j0, j1 = max(0, math.floor((y0 - origin[1]) / cell)), min(ny - 1, math.floor((y1 - origin[1]) / cell))
        for j in range(j0, j1 + 1):
            for i in range(i0, i1 + 1):
                if h > out[j * nx + i]:
                    out[j * nx + i] = h
    return out


def flat_patch(z, j, i, r, tol):
    """True if z[j][i] and every cell within `r` cells of it (a square) are on the grid, hit (not NaN) and
    within `tol` of z[j][i]."""
    if not (r <= j < len(z) - r and r <= i < len(z[0]) - r):
        return False
    c = z[j][i]
    return all(abs(z[jj][ii] - c) <= tol for jj in range(j - r, j + r + 1) for ii in range(i - r, i + r + 1))
