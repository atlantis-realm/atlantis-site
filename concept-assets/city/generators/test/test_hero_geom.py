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
    arc_lengths,
    bands,
    clear_runs,
    cull_aspects,
    disc_offsets,
    frustum_planes,
    gl_heading,
    lean_profile,
    polyline_dist,
    ring_crossing,
    safe_vfov,
    seen_ranges,
    sample_frames,
    side_dirs,
    side_points,
    sit_profile,
    stride_pick,
    thin_spots,
    walk_run,
    wall_top,
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


class SideTest(unittest.TestCase):
    def test_dirs_square_to_the_facing(self):
        (lx, ly), (rx, ry) = side_dirs(0.0, 2.0)   # facing +y (not unit): left is -x, right +x
        self.assertAlmostEqual(lx, -1.0)
        self.assertAlmostEqual(ly, 0.0)
        self.assertAlmostEqual(rx, 1.0)
        self.assertAlmostEqual(ry, 0.0)
        for fx, fy in ((1.0, 0.0), (0.6, -0.8)):
            for sx, sy in side_dirs(fx, fy):
                self.assertAlmostEqual(sx * fx + sy * fy, 0.0)
                self.assertAlmostEqual(math.hypot(sx, sy), 1.0)

    def test_points_either_side(self):
        (a, b) = side_points((-24.0, 10.0), (0.0, -1.0), 0.3)
        self.assertAlmostEqual(a[0], -23.7)   # facing -y: left is +x (into a facade at x = -23.945)
        self.assertAlmostEqual(b[0], -24.3)
        self.assertAlmostEqual(a[1], 10.0)
        self.assertAlmostEqual(b[1], 10.0)

    def test_corner_spot_rejected_by_the_level_check(self):
        # a building (no level ground: None) 0.3 m to one side fails lean_profile on the side points
        self.assertFalse(lean_profile(9.0, [9.0, None], 0.04))
        self.assertTrue(lean_profile(9.0, [9.0, 9.01], 0.04))


class WalkRunTest(unittest.TestCase):
    def test_level_run_round_the_start(self):
        zs = [None, 9.0, 9.1, 9.0, 9.05, None, 9.0]
        self.assertEqual(walk_run(zs, 3, 0.7), (1, 4))

    def test_step_too_high_cuts_the_run(self):
        # a kerb the robot can step up (0.6 m) is kept; a 2 m wall is not
        zs = [8.9, 8.9, 9.5, 9.5, 11.5, 11.5]
        self.assertEqual(walk_run(zs, 1, 0.7), (0, 3))
        self.assertEqual(walk_run(zs, 4, 0.7), (4, 5))

    def test_blocked_start(self):
        self.assertIsNone(walk_run([9.0, None, 9.0], 1, 0.7))


class BandsTest(unittest.TestCase):
    def test_runs_of_true_at_least_min_len(self):
        flags = [False, True, True, True, False, True, False, True, True]
        self.assertEqual(bands(flags, 2), [(1, 3), (7, 8)])

    def test_empty_and_all(self):
        self.assertEqual(bands([], 1), [])
        self.assertEqual(bands([True] * 4, 1), [(0, 3)])


class RingCrossingTest(unittest.TestCase):
    def test_ray_from_outside_the_ring_meets_it_ahead(self):
        # the hero avenue: from the well (0, -1210) toward the centre (0, 1168), ring r = 1980
        self.assertAlmostEqual(ring_crossing((0.0, -1210.0), (0.0, 1.0), (0.0, 1168.0), 1980.0), 398.0)

    def test_ring_behind_or_missed(self):
        self.assertIsNone(ring_crossing((0.0, -1210.0), (0.0, -1.0), (0.0, 1168.0), 1980.0))
        self.assertIsNone(ring_crossing((5000.0, 0.0), (0.0, 1.0), (0.0, 0.0), 100.0))

    def test_from_inside_the_ring_meets_it_on_the_way_out(self):
        self.assertAlmostEqual(ring_crossing((0.0, 0.0), (1.0, 0.0), (0.0, 0.0), 50.0), 50.0)


class ArcLengthsTest(unittest.TestCase):
    def test_cumulative_xy_length(self):
        self.assertEqual(arc_lengths([(0, 0, 0), (3, 4, 9), (3, 6, 0)]), [0.0, 5.0, 7.0])


class SeenRangesTest(unittest.TestCase):
    def test_range_of_the_seen_points_per_frame(self):
        ts = [0.0, 2.0, 4.0, 6.0]
        per = [(1, [False, True, True, False]), (6, [False] * 4), (11, [True, False, False, True])]
        self.assertEqual(seen_ranges(ts, per), [[1, 2.0, 4.0], [11, 0.0, 6.0]])


class WallTopTest(unittest.TestCase):
    def test_first_free_height_above_the_wall(self):
        hs = [0.9, 1.0, 1.1, 1.2, 1.3]
        self.assertEqual(wall_top(hs, [True, True, False, False, False]), 1.1)

    def test_tall_wall_or_nothing_at_contact(self):
        hs = [0.9, 1.0, 1.1]
        self.assertIsNone(wall_top(hs, [True, True, True]))
        self.assertIsNone(wall_top(hs, [False, True, True]))


class DiscOffsetsTest(unittest.TestCase):
    def test_cells_within_the_radius(self):
        offs = disc_offsets(1.0, 0.5)
        self.assertIn((0, 0), offs)
        self.assertIn((2, 0), offs)
        self.assertIn((-1, 1), offs)
        self.assertNotIn((2, 1), offs)   # 1.118 m out
        self.assertEqual(len(offs), 13)
        self.assertEqual(offs, sorted(offs))


if __name__ == "__main__":
    unittest.main()
