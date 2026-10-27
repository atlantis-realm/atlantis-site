"""Unit tests for robot_rig (the /city robot export's variant roll, bone pruning and walk measures).

    cd concept-assets/city/generators && python3 -m unittest discover -s test -p "test_*.py"
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from robot_rig import (keep_bones, stance_cycle_m, lowest_contact, skate_m, slot_parts,  # noqa: E402
                       socket_bone, is_weapon, roll_variants, SETS, SLOTS, ATTACH_FITS, BACK_ITEMS)


def pack_names():
    """Every body part of the six sets (both mesh files), the gun forearms and a few core parts."""
    names = ["Core_Head", "Core_Feet", "Core_Palm.L", "Core_Palm.R", "Char_Mech"]
    for st in SETS:
        for slot in SLOTS:
            names += [st + slot + ".L", st + slot + ".R"] if slot == "Forearm" else [st + slot]
        names += [st + "LimbGun.L", st + "LimbGun.R"]
    return names


ITEMS = sorted({i for fits in ATTACH_FITS.values() for i in fits} | set(BACK_ITEMS))


def tri_counts(names, each=200):
    return {n: each for n in list(names) + ITEMS}


class SlotParts(unittest.TestCase):
    def test_each_slot_from_its_set_plus_the_core(self):
        slots = {s: "Base_M_" for s in SLOTS}
        slots["Arm"] = "Base(A)_L_"
        got = slot_parts(pack_names(), slots)
        self.assertEqual(got, sorted(got))
        self.assertIn("Base(A)_L_Arm", got)
        self.assertNotIn("Base_M_Arm", got)
        self.assertIn("Base_M_Forearm.L", got)
        self.assertIn("Base_M_Forearm.R", got)
        self.assertIn("Core_Palm.L", got)
        self.assertEqual(len(got), len(SLOTS) + 1 + 4)   # Forearm is two meshes; four core parts
        self.assertFalse(any("LimbGun" in n for n in got))

    def test_missing_part_raises(self):
        slots = {s: "Base_M_" for s in SLOTS}
        with self.assertRaises(KeyError):
            slot_parts([n for n in pack_names() if n != "Base_M_Leg"], slots)


class SocketBone(unittest.TestCase):
    def test_socket_size_follows_its_slot(self):
        slots = {s: "Base_M_" for s in SLOTS}
        slots.update(Torso="Base(A)_S_", Leg="Base_L_", Forearm="Base_S_")
        self.assertEqual(socket_bone("Back", "", slots), "Back_S_Attachment")
        self.assertEqual(socket_bone("Knee", ".R", slots), "Knee_L_Attachment.R")
        self.assertEqual(socket_bone("Elbow", ".L", slots), "Elbow_S_Attachment.L")
        self.assertEqual(socket_bone("Shoulder", ".L", slots), "Shoulder_M_Attachment.L")


class Weapons(unittest.TestCase):
    def test_guns_missiles_and_weapon_carriers_are_weapons(self):
        for n in ["Attach_Gun_00", "Attach_Back_1Gun", "Attach_Back_2Gun", "Attach_Back_Missiles_01",
                  "Attach_Back_WeaponAttacher", "Base_M_LimbGun.L", "Core_Sword", "Core_Hammer"]:
            self.assertTrue(is_weapon(n), n)
        for n in ["Attach_Armour_00", "Attach_Module_02", "Attach_Back_JetPack_00", "Base_M_Arm"]:
            self.assertFalse(is_weapon(n), n)

    def test_no_weapon_can_be_rolled(self):
        for item in ITEMS:
            self.assertFalse(is_weapon(item), item)


class RollVariants(unittest.TestCase):
    def roll(self, k=8, seed=7, each=200, max_tris=6000):
        names = pack_names()
        return roll_variants(names, tri_counts(names, each), k, seed, max_tris)

    def test_deterministic_for_a_seed(self):
        self.assertEqual(self.roll(), self.roll())
        self.assertNotEqual(self.roll(seed=7), self.roll(seed=8))

    def test_k_distinct_variants_named_in_order(self):
        vs = self.roll()
        self.assertEqual([v["name"] for v in vs], [f"ROBOT_V{i}" for i in range(8)])
        sig = {(tuple(sorted(v["slots"].items())), tuple(v["attachments"])) for v in vs}
        self.assertEqual(len(sig), 8)

    def test_every_body_set_leads_some_variant(self):
        vs = self.roll()
        self.assertEqual({v["main"] for v in vs}, set(SETS))
        for v in vs:   # the main set holds most slots
            self.assertGreaterEqual(sum(1 for s in v["slots"].values() if s == v["main"]), len(SLOTS) - 2)

    def test_parts_attachments_and_sockets_are_consistent(self):
        for v in self.roll():
            self.assertEqual(v["parts"], slot_parts(pack_names(), v["slots"]))
            sockets = [s for _, s in v["attachments"]]
            self.assertEqual(len(sockets), len(set(sockets)), v["name"])
            self.assertGreaterEqual(len(v["attachments"]), 1, v["name"])
            for item, sock in v["attachments"]:
                self.assertFalse(is_weapon(item))
                kind = sock.split("_")[0]
                self.assertIn(item, BACK_ITEMS if kind == "Back" else ATTACH_FITS[kind], sock)
                side = sock[-2:] if sock.endswith((".L", ".R")) else ""
                self.assertEqual(sock, socket_bone(kind, side, v["slots"]))
                if side:   # limb items come in mirrored pairs
                    other = sock[:-1] + ("R" if side == ".L" else "L")
                    self.assertIn((item, other), v["attachments"])

    def test_triangle_cap(self):
        for v in self.roll(each=400, max_tris=7000):
            self.assertLessEqual(v["tris"], 7000, v["name"])
        with self.assertRaises(ValueError):
            self.roll(each=1000, max_tris=1000)


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
