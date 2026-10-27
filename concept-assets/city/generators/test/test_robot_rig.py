"""Unit tests for robot_rig (the /city robot export's bone pruning, part pick and walk measures).

    cd concept-assets/city/generators && python3 -m unittest discover -s test -p "test_*.py"
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from robot_rig import keep_bones, pick_parts, stance_cycle_m, lowest_contact, skate_m  # noqa: E402

# A cut of the pack's mesh names: three body sets, the gun forearms and the shared core.
PACK = ["Base_L_Arm", "Base_L_Forearm.L", "Base_M_Arm", "Base_M_Forearm.L", "Base_M_Forearm.R",
        "Base_M_LimbGun.L", "Base_M_LimbGun.R", "Base_M_Torso", "Base_S_Torso", "Core_Head", "Core_Palm.L",
        "Core_Palm.R", "Core_Feet", "arp_dummy_mesh"]


class PickParts(unittest.TestCase):
    def test_medium_set_plain_forearms_and_core_sorted(self):
        self.assertEqual(pick_parts(list(reversed(PACK))),
                         ["Base_M_Arm", "Base_M_Forearm.L", "Base_M_Forearm.R", "Base_M_Torso", "Core_Feet",
                          "Core_Head", "Core_Palm.L", "Core_Palm.R"])

    def test_never_a_limb_gun_or_another_set(self):
        for name in pick_parts(PACK):
            self.assertNotIn("LimbGun", name)
            self.assertFalse(name.startswith(("Base_L_", "Base_S_")), name)


class KeepBones(unittest.TestCase):
    PARENTS = {"traj": None, "root": "traj", "spine": "root", "attach": "spine", "head": "spine",
               "thigh": "root", "leg": "thigh", "foot": "leg", "toe_tip": "foot", "look": "traj"}

    def test_weighted_bones_and_their_ancestors(self):
        self.assertEqual(keep_bones(self.PARENTS, {"head", "foot"}),
                         {"traj", "root", "spine", "head", "thigh", "leg", "foot"})

    def test_unknown_weighted_bone_raises(self):
        with self.assertRaises(KeyError):
            keep_bones(self.PARENTS, {"nope"})


class StanceCycle(unittest.TestCase):
    def test_constant_stance_speed(self):
        # One foot, 10-frame loop (11 samples, last = first): on the ground for frames 0-5 sliding back
        # 0.1 m a frame, then lifted and swung forward. 0.1 m/frame x 10 frames = 1 m per loop.
        fwd = [0.25, 0.15, 0.05, -0.05, -0.15, -0.25, -0.1, 0.05, 0.15, 0.3, 0.25]
        z = [0.03] * 6 + [0.2, 0.3, 0.3, 0.2, 0.03]
        self.assertAlmostEqual(stance_cycle_m([(z, fwd)], eps=0.005), 1.0)

    def test_two_feet_averaged_over_contact_pairs(self):
        # (z, fwd) per frame, 4-frame loop. Pairs of neighbouring frames both on the ground: a (0,1) and
        # (1,2) slide 0.2 m; b (1,2) and (2,3) slide 0.3 m. Mean 0.25 m/frame x 4 frames = 1.0.
        a = ([0.0, 0.0, 0.0, 0.5, 0.0], [1.0, 0.8, 0.6, 1.0, 1.0])
        b = ([0.5, 0.0, 0.0, 0.0, 0.5], [0.0, 0.4, 0.1, -0.2, 0.0])
        self.assertAlmostEqual(stance_cycle_m([a, b], eps=0.01), 1.0)

    def test_no_contact_raises(self):
        with self.assertRaises(ValueError):
            stance_cycle_m([([0.0, 0.5], [0.0, 0.0])], eps=0.01)


class Skate(unittest.TestCase):
    def test_planted_foot_drift_against_the_ground(self):
        # 4-frame loop at 1 m/loop (0.25 m/frame): frames 0-2 planted, sliding 0.25 then 0.35 m back, so
        # against the ground it drifts 0 then 0.1 m: the worst run's spread is 0.1.
        z = [0.0, 0.0, 0.0, 0.4, 0.0]
        fwd = [1.0, 0.75, 0.4, 0.9, 1.0]
        self.assertAlmostEqual(skate_m([(z, fwd)], eps=0.01, cycle_m=1.0), 0.1)

    def test_no_drift_at_the_measured_speed(self):
        fwd = [0.25, 0.15, 0.05, -0.05, -0.15, -0.25, -0.1, 0.05, 0.15, 0.3, 0.25]
        z = [0.03] * 6 + [0.2, 0.3, 0.3, 0.2, 0.03]
        feet = [(z, fwd)]
        self.assertAlmostEqual(skate_m(feet, 0.005, stance_cycle_m(feet, 0.005)), 0.0)


class LowestContact(unittest.TestCase):
    def test_frames_within_eps_of_the_lowest(self):
        self.assertEqual(lowest_contact([0.031, 0.032, 0.040, 0.2, 0.0355], 0.005), [True, True, False, False, True])


if __name__ == "__main__":
    unittest.main()
