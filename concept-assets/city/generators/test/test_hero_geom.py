"""Unit tests for hero_geom (the /city hero export's cull geometry).

    cd concept-assets/city/generators && python3 -m unittest discover -s test -p "test_*.py"
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from hero_geom import (  # noqa: E402
    MIN_ASPECT,
    aabb_in_frustum,
    clear_runs,
    cull_aspects,
    frustum_planes,
    safe_vfov,
    sample_frames,
)

# Camera at the origin looking down +Y (Blender is Z-up), 16:9, the hero camera's vfov.
POS = (0.0, 0.0, 0.0)
FWD = (0.0, 1.0, 0.0)
UP = (0.0, 0.0, 1.0)
VFOV = math.radians(33.4)
ASPECT = 16 / 9
NEAR, FAR = 0.2, 8000.0
SAFE_HALF_TAN = math.tan(VFOV / 2) * 16 / 9


def box(cx, cy, cz, h=1.0):
    return (cx - h, cy - h, cz - h), (cx + h, cy + h, cz + h)


def planes(margin=0.0):
    return frustum_planes(POS, FWD, UP, VFOV, ASPECT, NEAR, FAR, margin=margin)


class FrustumTest(unittest.TestCase):
    def test_six_planes(self):
        self.assertEqual(len(planes()), 6)

    def test_box_straight_ahead_is_in(self):
        self.assertTrue(aabb_in_frustum(*box(0, 100, 0), planes()))

    def test_box_behind_camera_is_out(self):
        self.assertFalse(aabb_in_frustum(*box(0, -100, 0), planes()))

    def test_box_just_past_right_edge_needs_margin(self):
        # Right edge of the view at distance 100: x = 100 * tan(hfov / 2).
        half_h = math.atan(math.tan(VFOV / 2) * ASPECT)
        edge_x = 100 * math.tan(half_h)
        lo, hi = box(edge_x + 2.0, 100, 0, h=1.0)  # ~0.5 m clear of the edge at its nearest corner
        self.assertFalse(aabb_in_frustum(lo, hi, planes(0.0)))
        self.assertTrue(aabb_in_frustum(lo, hi, planes(0.05)))

    def test_box_beyond_far_is_out(self):
        self.assertFalse(aabb_in_frustum(*box(0, FAR + 10, 0), planes()))

    def test_box_straddling_a_plane_is_in(self):
        half_h = math.atan(math.tan(VFOV / 2) * ASPECT)
        edge_x = 100 * math.tan(half_h)
        self.assertTrue(aabb_in_frustum(*box(edge_x, 100, 0, h=2.0), planes()))
        # ... and straddling the near plane.
        self.assertTrue(aabb_in_frustum(*box(0, 0, 0, h=0.5), planes()))

    def test_tilted_camera(self):
        # Looking straight down: a box below is in, a box ahead on the horizon is out.
        p = frustum_planes((0, 0, 100), (0, 0, -1), (0, 1, 0), VFOV, ASPECT, NEAR, FAR)
        self.assertTrue(aabb_in_frustum(*box(0, 0, 0), p))
        self.assertFalse(aabb_in_frustum(*box(0, 500, 100), p))


class SafeFrameTest(unittest.TestCase):
    def test_16_9_keeps_base(self):
        self.assertAlmostEqual(safe_vfov(16 / 9, VFOV, SAFE_HALF_TAN), VFOV, places=9)

    def test_wider_keeps_base(self):
        self.assertAlmostEqual(safe_vfov(21 / 9, VFOV, SAFE_HALF_TAN), VFOV, places=9)

    def test_portrait_keeps_safe_half_width_visible(self):
        aspect = 9 / 19.5
        v = safe_vfov(aspect, VFOV, SAFE_HALF_TAN)
        self.assertGreater(v, VFOV)
        visible_half_tan = math.tan(v / 2) * aspect
        self.assertGreaterEqual(visible_half_tan, SAFE_HALF_TAN - 1e-9)
        self.assertAlmostEqual(visible_half_tan, SAFE_HALF_TAN, places=9)

    def test_matches_ts_safe_frame_fov(self):
        # heroCamera.test.ts: portrait 9:19.5 with these inputs; same formula in degrees.
        aspect = 9 / 19.5
        expected_deg = max(33.4, math.degrees(2 * math.atan(SAFE_HALF_TAN / aspect)))
        self.assertAlmostEqual(math.degrees(safe_vfov(aspect, VFOV, SAFE_HALF_TAN)), expected_deg, places=9)


    def test_narrower_than_min_aspect_uses_min_aspect(self):
        # A 9:21 phone or a split-screen window: no wider than the narrowest culled FOV.
        self.assertAlmostEqual(MIN_ASPECT, 9 / 19.5)
        at_min = safe_vfov(MIN_ASPECT, VFOV, SAFE_HALF_TAN)
        self.assertAlmostEqual(safe_vfov(9 / 21, VFOV, SAFE_HALF_TAN), at_min, places=12)
        self.assertAlmostEqual(safe_vfov(0.2, VFOV, SAFE_HALF_TAN), at_min, places=12)


class ClearRunsTest(unittest.TestCase):
    def test_all_clear_open(self):
        self.assertEqual(clear_runs([1, 2, 3], False, lambda p: True), [[1, 2, 3]])

    def test_all_clear_closed_repeats_first(self):
        self.assertEqual(clear_runs([1, 2, 3], True, lambda p: True), [[1, 2, 3, 1]])

    def test_open_split_and_short_runs_dropped(self):
        self.assertEqual(clear_runs([1, 2, 3, 4, 5, 6, 7], False, lambda p: p not in (3, 5)), [[1, 2], [6, 7]])

    def test_closed_cut_keeps_arc_across_start(self):
        # Points 0..7 on a loop, 4 and 5 blocked: one arc 6, 7, 0, 1, 2, 3.
        self.assertEqual(clear_runs(list(range(8)), True, lambda p: p not in (4, 5)), [[6, 7, 0, 1, 2, 3]])

    def test_none_clear(self):
        self.assertEqual(clear_runs([1, 2, 3], True, lambda p: False), [])


class SamplingTest(unittest.TestCase):
    def test_sample_frames(self):
        f = sample_frames()
        self.assertEqual(f[0], 1)
        self.assertEqual(f[-1], 250)
        self.assertTrue(all(a < b for a, b in zip(f, f[1:])))

    def test_sample_frames_step_lands_on_end(self):
        self.assertEqual(sample_frames(1, 11, 5), [1, 6, 11])
        self.assertEqual(sample_frames(3, 3, 5), [3])

    def test_cull_aspects(self):
        a = cull_aspects(VFOV, SAFE_HALF_TAN)
        self.assertEqual(len(a), 3)
        by_aspect = dict(a)
        self.assertIn(16 / 9, by_aspect)
        self.assertIn(21 / 9, by_aspect)
        self.assertIn(9 / 19.5, by_aspect)
        self.assertGreater(by_aspect[9 / 19.5], by_aspect[16 / 9])


if __name__ == "__main__":
    unittest.main()
