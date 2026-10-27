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
    gl_heading,
    lean_profile,
    polyline_dist,
    safe_vfov,
    sample_frames,
    sit_profile,
    stride_pick,
    thin_spots,
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


class HeadingTest(unittest.TestCase):
    # glTF is (x, z, -y) of Blender; heading turns local +Z (glTF) to the facing, like walkerPose.
    def test_blender_minus_y_is_gltf_plus_z(self):
        self.assertAlmostEqual(gl_heading(0, -1), 0.0)

    def test_blender_plus_x_is_quarter_turn(self):
        self.assertAlmostEqual(gl_heading(1, 0), math.pi / 2)

    def test_blender_plus_y_is_half_turn(self):
        self.assertAlmostEqual(abs(gl_heading(0, 1)), math.pi)

    def test_matches_walker_pose_atan2(self):
        # walkerPose: heading = atan2(dx, dz) of a glTF direction; Blender (fx, fy) is glTF (fx, -fy).
        for fx, fy in ((0.6, 0.8), (-0.3, 0.2), (0.0, -2.0)):
            self.assertAlmostEqual(gl_heading(fx, fy), math.atan2(fx, -fy))


class PolylineDistTest(unittest.TestCase):
    def test_distance_to_segment_interior_and_ends(self):
        path = [(0, 0), (10, 0)]
        self.assertAlmostEqual(polyline_dist((5, 3), path), 3.0)
        self.assertAlmostEqual(polyline_dist((-3, 4), path), 5.0)
        self.assertAlmostEqual(polyline_dist((13, 0), path), 3.0)

    def test_nearest_of_several_segments(self):
        self.assertAlmostEqual(polyline_dist((11, 5), [(0, 0), (10, 0), (10, 10)]), 1.0)

    def test_single_point_and_empty(self):
        self.assertAlmostEqual(polyline_dist((3, 4), [(0, 0)]), 5.0)
        self.assertEqual(polyline_dist((3, 4), []), math.inf)


class ThinSpotsTest(unittest.TestCase):
    def test_keeps_first_of_each_cluster_in_order(self):
        pts = [(0, 0), (0.5, 0), (1.2, 0), (5, 5), (5.4, 5.4)]
        self.assertEqual(thin_spots(pts, 1.0), [0, 2, 3])

    def test_exactly_min_dist_is_kept(self):
        self.assertEqual(thin_spots([(0, 0), (1, 0)], 1.0), [0, 1])

    def test_uses_only_xy(self):
        self.assertEqual(thin_spots([(0, 0, 0), (0, 0, 5)], 1.0), [0])


class StridePickTest(unittest.TestCase):
    def test_short_list_unchanged(self):
        self.assertEqual(stride_pick(list(range(5)), 10), [0, 1, 2, 3, 4])

    def test_even_spread_with_both_ends(self):
        self.assertEqual(stride_pick(list(range(10)), 4), [0, 3, 6, 9])
        self.assertEqual(len(stride_pick(list(range(1000)), 400)), 400)

    def test_deterministic(self):
        self.assertEqual(stride_pick(list(range(37)), 7), stride_pick(list(range(37)), 7))


class SitProfileTest(unittest.TestCase):
    DROP = (0.35, 0.6)

    def test_flat_seat_and_level_ground_gives_the_drop(self):
        self.assertAlmostEqual(sit_profile(1.0, [1.0, 1.01, 0.99], [0.55, 0.54, 0.55], self.DROP, 0.03), 0.45, places=6)

    def test_drop_out_of_range(self):
        self.assertIsNone(sit_profile(1.0, [1.0], [0.8, 0.8], self.DROP, 0.03))   # 0.2: a kerb, too low
        self.assertIsNone(sit_profile(1.0, [1.0], [0.2, 0.2], self.DROP, 0.03))   # 0.8: too high

    def test_seat_not_flat(self):
        self.assertIsNone(sit_profile(1.0, [1.0, 1.2], [0.55, 0.55], self.DROP, 0.03))

    def test_ground_in_front_steps_again(self):
        # The next ring down starts under the feet: not level ground.
        self.assertIsNone(sit_profile(1.0, [1.0], [0.55, 0.1], self.DROP, 0.03))

    def test_missing_probe(self):
        self.assertIsNone(sit_profile(1.0, [None], [0.55], self.DROP, 0.03))
        self.assertIsNone(sit_profile(1.0, [1.0], [0.55, None], self.DROP, 0.03))


class LeanProfileTest(unittest.TestCase):
    def test_level_free_ground(self):
        self.assertTrue(lean_profile(2.0, [2.0, 2.02, 1.99], 0.05))

    def test_step_or_hole_in_front(self):
        self.assertFalse(lean_profile(2.0, [2.0, 1.7], 0.05))
        self.assertFalse(lean_profile(2.0, [2.0, None], 0.05))


if __name__ == "__main__":
    unittest.main()
