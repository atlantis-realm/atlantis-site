"""Unit tests for oneoff/cull_unseen (the v06 clean-up: objects the hero camera never sees).

    cd concept-assets/city/generators && python3 -m unittest discover -s test -p "test_*.py"
"""
import math
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "oneoff"))

from hero_geom import aabb_in_frustum, frustum_planes  # noqa: E402
from cull_unseen import (  # noqa: E402
    boxes_in_any,
    drop_poses,
    sanity,
    select_culled,
    tree_root,
    widen_planes,
)

try:
    import numpy  # noqa: F401
except ImportError:
    numpy = None

# Camera at the origin looking down +Y (Blender is Z-up), 16:9, the hero camera's vfov.
POS, FWD, UP = (0.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)
VFOV = math.radians(33.166)


def planes(margin_m=0.0):
    return widen_planes(frustum_planes(POS, FWD, UP, VFOV, 16 / 9, 0.2, 8000.0), margin_m)


def obj(parent=None, protected=None, seen=False):
    return {"parent": parent, "protected": protected, "seen": seen}


class WidenPlanes(unittest.TestCase):
    def test_box_just_past_the_edge_comes_back_in(self):
        # 100 m ahead the 16:9 half width is 100 * tan(hfov/2); a box 20 m past it is out, then in at 30 m
        half_w = 100 * math.tan(VFOV / 2) * 16 / 9
        lo, hi = (half_w + 20, 99, -1), (half_w + 21, 101, 1)
        self.assertFalse(aabb_in_frustum(lo, hi, planes()))
        self.assertTrue(aabb_in_frustum(lo, hi, planes(30.0)))

    def test_far_box_stays_out(self):
        lo, hi = (10000.0, 99.0, -1.0), (10001.0, 101.0, 1.0)
        self.assertFalse(aabb_in_frustum(lo, hi, planes(30.0)))

    def test_behind_the_camera_within_the_margin(self):
        # the near plane moves back too: a box 10 m behind the eye counts as in
        self.assertTrue(aabb_in_frustum((-1, -11, -1), (1, -10, 1), planes(30.0)))
        self.assertFalse(aabb_in_frustum((-1, -50, -1), (1, -45, 1), planes(30.0)))

    def test_shifts_d_only(self):
        p = [(0.0, 1.0, 0.0, -2.0)]
        self.assertEqual(widen_planes(p, 3.0), [(0.0, 1.0, 0.0, 1.0)])


class DropPoses(unittest.TestCase):
    PITCHED = (0.0, math.cos(-0.3), math.sin(-0.3))     # looking 0.3 rad down
    PUP = (0.0, math.sin(0.3), math.cos(0.3))

    def test_ends(self):
        poses = drop_poses((1.0, 2.0, 10.3095), self.PITCHED, self.PUP, 8.62, steps=11)
        self.assertEqual(len(poses), 11)
        (p0, f0, u0), (p1, f1, u1) = poses[0], poses[-1]
        self.assertAlmostEqual(p0[2], 10.3095)
        self.assertAlmostEqual(p1[2], 8.62)
        self.assertEqual(p0[:2], (1.0, 2.0))
        self.assertEqual(p1[:2], (1.0, 2.0))
        for a, b in zip(f0, self.PITCHED):
            self.assertAlmostEqual(a, b)
        for a, b in zip(f1, (0.0, 1.0, 0.0)):   # level, same heading
            self.assertAlmostEqual(a, b)
        for a, b in zip(u1, (0.0, 0.0, 1.0)):
            self.assertAlmostEqual(a, b)

    def test_straight_down_never_below_ground(self):
        zs = [p[2] for p, _, _ in drop_poses((0, 0, 10.0), self.PITCHED, self.PUP, 8.0, steps=21)]
        self.assertTrue(all(a >= b for a, b in zip(zs, zs[1:])))
        self.assertTrue(all(z >= 8.0 for z in zs))
        # eased in like dropPose: d = 0.5 has dropped a quarter of the way
        self.assertAlmostEqual(zs[10], 10.0 - 2.0 * 0.25)

    def test_unit_vectors(self):
        for _, f, u in drop_poses((0, 0, 10.0), self.PITCHED, self.PUP, 8.0, steps=7):
            self.assertAlmostEqual(math.sqrt(sum(c * c for c in f)), 1.0)
            self.assertAlmostEqual(math.sqrt(sum(c * c for c in u)), 1.0)


@unittest.skipIf(numpy is None, "numpy not installed")
class BoxesInAny(unittest.TestCase):
    def test_matches_aabb_in_frustum(self):
        rnd = random.Random(7)
        frusta = [widen_planes(frustum_planes(POS, (math.cos(a), math.sin(a), 0.0), UP, VFOV, asp, 0.2, 2000.0,
                                              margin=0.03), m)
                  for a, asp, m in ((1.2, 16 / 9, 0.0), (2.0, 9 / 19.5, 30.0), (-1.0, 21 / 9, 5.0))]
        lo, hi = [], []
        for _ in range(500):
            c = [rnd.uniform(-2500, 2500), rnd.uniform(-2500, 2500), rnd.uniform(-50, 300)]
            s = [rnd.uniform(0.5, 200) for _ in range(3)]
            lo.append([c[i] - s[i] for i in range(3)])
            hi.append([c[i] + s[i] for i in range(3)])
        got = boxes_in_any(lo, hi, frusta, chunk=64)
        want = [any(aabb_in_frustum(tuple(a), tuple(b), p) for p in frusta) for a, b in zip(lo, hi)]
        self.assertEqual(list(map(bool, got)), want)
        self.assertTrue(0 < sum(want) < len(want))


class SelectCulled(unittest.TestCase):
    def test_unseen_tree_goes_with_its_empty_parent(self):
        culled, kept = select_culled({"E": obj(seen=None), "A": obj("E"), "B": obj("E")})
        self.assertEqual(culled, {"E", "A", "B"})
        self.assertEqual(kept, {})

    def test_one_seen_member_keeps_the_tree(self):
        culled, kept = select_culled({"E": obj(seen=None), "A": obj("E"), "B": obj("A", seen=True)})
        self.assertEqual(culled, set())
        self.assertEqual(kept, {"E": "in view"})

    def test_protected_member_keeps_the_tree(self):
        culled, kept = select_culled({"R": obj(), "C": obj("R", protected="type CAMERA", seen=None), "X": obj()})
        self.assertEqual(culled, {"X"})
        self.assertEqual(kept, {"R": "protected: type CAMERA"})

    def test_no_bounds_kept(self):
        culled, kept = select_culled({"E": obj(seen=None), "F": obj("E", seen=None)})
        self.assertEqual(culled, set())
        self.assertEqual(kept, {"E": "no bounds"})

    def test_tree_root_survives_a_cycle(self):
        self.assertIn(tree_root("a", {"a": "b", "b": "a"}), ("a", "b"))
        self.assertEqual(tree_root("c", {"c": "b", "b": "a", "a": None}), "a")


class Sanity(unittest.TestCase):
    def test_limits(self):
        self.assertEqual(sanity(30, 100), (True, 0.3))
        self.assertFalse(sanity(2, 100)[0])
        self.assertFalse(sanity(99, 100)[0])
        self.assertEqual(sanity(0, 0), (False, 0.0))


if __name__ == "__main__":
    unittest.main()
