"""Unit tests for people_cast (the /city people export's cast, walk curves and atlas maths).

    cd concept-assets/city/generators && python3 -m unittest discover -s test -p "test_*.py"
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from people_cast import (  # noqa: E402
    ATLAS_COLS,
    ATLAS_ROWS,
    PEOPLE_VARIANTS,
    UNIFORM_SLOTS,
    POSE_KEYS,
    WALK_KEYS,
    allowed,
    atlas_uv,
    key_phases,
    pick_variants,
    solve_increasing,
    two_bone,
    uniform_kind,
    walk_pose,
)

# A cut of the pack's rigged file names (Models/Rig and Extras_Rig), with the ones that must never be picked.
MALE = ([f"Character_{i:02d}" for i in range(1, 17)] + [f"Character_{i}_Police" for i in range(17, 23)]
        + ["Character_23_Firefighter", "Character_24_Firefighter", "Character_25_Doctor", "Character_26_Doctor",
           "Character_27_HM", "Character_28_HM"] + [f"Character_{i}" for i in range(29, 33)]
        + [f"Character_Male_{i}" for i in range(33, 58)] + ["Character_Sheriff_N", "Character_Sheriff_N_01"])
FEMALE = ([f"Character_{i}_Female_Police" for i in (17, 18, 19, 20, 25, 26)]
          + ["Character_21_Female_Firefighter", "Character_22_Female_Firefighter", "Character_23_Female_Doctor",
             "Character_24_Female_Doctor", "Character_27_Female_HM", "Character_28_Female_HM"]
          + [f"Character_{i}_Female" for i in list(range(29, 56)) + [57]]
          + ["Character_56_Female_Exotic_dancer", "Character_56_Female_Exotic_dancer_01"]
          + [f"Character_Female_{i:02d}" for i in range(1, 17)])
KILLERS = ["Character_Killer", "Character_Killer_01", "Character_Killer_10_01", "Character_Monster", "Character_Monster_08"]
POOL = [("M", n) for n in MALE + KILLERS] + [("F", n) for n in FEMALE]


class CastTest(unittest.TestCase):
    def test_allowed(self):
        for name in KILLERS + ["Character_56_Female_Exotic_dancer", "character_killer_x", "MONSTER"]:
            self.assertFalse(allowed(name), name)
        for name in ["Character_01", "Character_17_Police", "Character_Sheriff_N", "Character_27_Female_HM"]:
            self.assertTrue(allowed(name), name)

    def test_uniform_kind(self):
        self.assertEqual(uniform_kind("Character_17_Police"), "Police")
        self.assertEqual(uniform_kind("Character_21_Female_Firefighter"), "Firefighter")
        self.assertEqual(uniform_kind("Character_27_HM"), "HM")
        self.assertEqual(uniform_kind("Character_Sheriff_N_01"), "Sheriff")
        self.assertIsNone(uniform_kind("Character_Male_40"))
        self.assertIsNone(uniform_kind("Character_Female_03"))

    def test_pick_count_mix_and_exclusions(self):
        cast = pick_variants(POOL)
        self.assertEqual(len(cast), PEOPLE_VARIANTS)
        self.assertEqual(len({v["name"] for v in cast}), PEOPLE_VARIANTS)
        for v in cast:
            self.assertTrue(allowed(v["name"]), v["name"])
        uniforms = [v for v in cast if v["kind"]]
        self.assertEqual(len(uniforms), len(UNIFORM_SLOTS))
        self.assertEqual(len({v["kind"] for v in uniforms}), len(UNIFORM_SLOTS))  # one of each kind
        self.assertEqual(sum(v["gender"] == "M" for v in cast), PEOPLE_VARIANTS // 2)

    def test_pick_is_order_independent_and_repeatable(self):
        a = pick_variants(POOL)
        self.assertEqual(a, pick_variants(list(reversed(POOL))))
        self.assertEqual(a, pick_variants(POOL + POOL))  # Models/Rig and Extras_Rig carry the same files

    def test_pick_never_takes_excluded_even_if_only_ones(self):
        cast = pick_variants([("M", n) for n in KILLERS] + POOL)
        self.assertFalse(any(not allowed(v["name"]) for v in cast))


class WalkTest(unittest.TestCase):
    def test_key_phases(self):
        self.assertEqual(WALK_KEYS, 6)
        self.assertEqual(key_phases(), [i / 6 for i in range(6)])

    def test_left_right_half_cycle_symmetry(self):
        for i in range(12):
            p = i / 12
            a, b = walk_pose(p), walk_pose((p + 0.5) % 1)
            for part in ("thigh", "knee", "arm", "elbow"):
                self.assertAlmostEqual(a["L"][part], b["R"][part], places=9, msg=(p, part))

    def test_contact_at_phase_zero(self):
        p = walk_pose(0.0)
        self.assertGreater(p["L"]["thigh"], 0)   # left leg forward
        self.assertLess(p["R"]["thigh"], 0)      # right leg back
        self.assertLess(p["L"]["arm"], 0)        # left arm back (counter-swing)
        self.assertAlmostEqual(p["L"]["knee"], p["R"]["knee"], places=9)  # both legs nearly straight

    def test_swing_knee_bends_more(self):
        # Left leg swings (back to front) over phase 0.5-1: its knee bends more than the stance knee.
        for p in (4 / 6, 5 / 6):
            pose = walk_pose(p)
            self.assertGreater(pose["L"]["knee"], pose["R"]["knee"] + 15)


class PoseTest(unittest.TestCase):
    def test_pose_keys_follow_the_walk(self):
        self.assertEqual(POSE_KEYS, ("sit", "lean"))

    def test_two_bone_reaches_with_bone_lengths(self):
        root, target, pole = (0.0, 0.0, 1.0), (0.3, 0.1, 0.6), (-1.0, 0.0, 0.0)
        mid = two_bone(root, target, 0.3, 0.25, pole)
        self.assertAlmostEqual(math.dist(root, mid), 0.3, places=9)
        self.assertAlmostEqual(math.dist(mid, target), 0.25, places=9)

    def test_two_bone_bends_toward_pole(self):
        root, target = (0.0, 0.0, 1.0), (0.0, 0.0, 0.6)
        for pole in ((1.0, 0.0, 0.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0)):
            mid = two_bone(root, target, 0.3, 0.25, pole)
            self.assertGreater(sum(m * p for m, p in zip(mid, pole)), 0.1, (pole, mid))

    def test_two_bone_out_of_reach_goes_straight(self):
        root, target = (0.0, 0.0, 0.0), (0.0, 0.0, -2.0)
        mid = two_bone(root, target, 0.3, 0.25, (1.0, 0.0, 0.0))
        self.assertAlmostEqual(mid[2], -0.3, places=3)
        self.assertLess(abs(mid[0]), 0.02)

    def test_solve_increasing(self):
        x = solve_increasing(lambda t: t * t, 0.0, 2.0, 2.0)
        self.assertAlmostEqual(x, math.sqrt(2), places=4)
        self.assertEqual(solve_increasing(lambda t: t, 0.0, 1.0, 5.0), 1.0)   # clamps to the range
        self.assertEqual(solve_increasing(lambda t: t, 0.0, 1.0, -5.0), 0.0)


class AtlasTest(unittest.TestCase):
    def test_tiles_cover_grid(self):
        self.assertGreaterEqual(ATLAS_COLS * ATLAS_ROWS, PEOPLE_VARIANTS)
        lo = atlas_uv(0.0, 0.0, 0)
        hi = atlas_uv(1.0, 1.0, ATLAS_COLS * ATLAS_ROWS - 1)
        self.assertGreater(lo[0], 0)
        self.assertLess(hi[0], 1)
        self.assertGreater(lo[1], 0)
        self.assertLess(hi[1], 1)

    def test_tile_stays_in_its_cell(self):
        for t in range(ATLAS_COLS * ATLAS_ROWS):
            col, row = t % ATLAS_COLS, t // ATLAS_COLS
            for u, v in ((0, 0), (1, 1), (0.5, 0.25), (1.7, -0.3)):  # wrapped UVs fold back into the tile
                x, y = atlas_uv(u, v, t)
                self.assertTrue(col / ATLAS_COLS < x < (col + 1) / ATLAS_COLS, (t, u, v, x))
                self.assertTrue(row / ATLAS_ROWS < y < (row + 1) / ATLAS_ROWS, (t, u, v, y))

    def test_inside_is_linear(self):
        a, b, c = atlas_uv(0.2, 0.4, 5), atlas_uv(0.4, 0.4, 5), atlas_uv(0.6, 0.4, 5)
        self.assertTrue(math.isclose(b[0] - a[0], c[0] - b[0], rel_tol=1e-9))


if __name__ == "__main__":
    unittest.main()
