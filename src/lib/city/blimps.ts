// Greybox blimps for the /city hero: `count` hulls on one slow circle around
// the Lantern, evenly spaced and gently bobbing (spec "Moving things"). The
// orbit (count, radius, altitude, period) and the hull size (len, r, from the
// plan's o.blimps) come from hero_props.json, chosen by export_hero.py so one
// blimp is usually in the frame-1 view. All blimps are one InstancedMesh.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HeroProps, Vec3 } from './props.ts';

/** Bob amplitude (m) and period (s); each blimp's bob is offset by its index (radians). */
export const BLIMP_BOB_M = 4;
const BLIMP_BOB_PERIOD_S = 37;

/** Hull tessellation: segments per cap and around the hull. */
const HULL_CAP_SEGMENTS = 8;
const HULL_RADIAL_SEGMENTS = 16;
/** Fins, as fractions of the hull: chord of len, span and thickness of r. */
const FIN_CHORD = 0.2;
const FIN_SPAN = 0.9;
const FIN_THICKNESS = 0.08;
/** Fins start this far (in r) in from the tail tip, and their roots sit this deep (in r) inside the hull. */
const FIN_TAIL_INSET = 0.5;
const FIN_ROOT = 0.6;
const BLIMP_COLOR = 0xd8d4cc;
const BLIMP_ROUGHNESS = 0.7;

export type Blimps = HeroProps['blimps'];
export type BlimpPose = { position: Vec3; yaw: number };

/**
 * Blimp `i` at time `t` (s). angle = 2π(i/count + t/period_s); position =
 * centre + radius·(cos, ·, sin) on the xz plane, at y = altitude + bob (altitude
 * is absolute, not relative to the centre). yaw (about +Y) turns the hull's nose,
 * +X, along the direction of travel.
 */
export function blimpPose(i: number, t: number, b: Blimps, centre: Vec3): BlimpPose {
	const angle = 2 * Math.PI * (i / b.count + t / b.period_s);
	const bob = BLIMP_BOB_M * Math.sin((2 * Math.PI * t) / BLIMP_BOB_PERIOD_S + i);
	return {
		position: [
			centre[0] + b.radius * Math.cos(angle),
			b.altitude + bob,
			centre[2] + b.radius * Math.sin(angle)
		],
		// Travel is d/dangle (cos, sin) = (−sin, cos); +X rotated by yaw about +Y is (cos yaw, −sin yaw).
		yaw: -angle - Math.PI / 2
	};
}

/** One greybox blimp: a capsule hull `len` long along +X with radius `r`, plus 4 tail fins. */
function blimpGeometry(len: number, r: number): THREE.BufferGeometry {
	const hull = new THREE.CapsuleGeometry(r, len - 2 * r, HULL_CAP_SEGMENTS, HULL_RADIAL_SEGMENTS);
	hull.rotateZ(-Math.PI / 2); // capsule axis +Y → +X (nose)

	const chord = FIN_CHORD * len;
	const span = FIN_SPAN * r;
	const finX = -len / 2 + FIN_TAIL_INSET * r + chord / 2;
	const out = FIN_ROOT * r + span / 2;
	const parts: THREE.BufferGeometry[] = [hull];
	for (let k = 0; k < 4; k++) {
		const fin = new THREE.BoxGeometry(chord, span, FIN_THICKNESS * r);
		fin.translate(0, out, 0);
		fin.rotateX((k * Math.PI) / 2); // up, side, down, side
		fin.translate(finX, 0, 0);
		parts.push(fin);
	}
	const merged = mergeGeometries(parts);
	for (const p of parts) p.dispose();
	if (!merged) throw new Error('blimps: could not merge the hull and fins');
	return merged;
}

/** `count` blimps in one InstancedMesh (one draw call); place them with updateBlimps(). */
export function createBlimps(b: Blimps): THREE.InstancedMesh {
	const material = new THREE.MeshStandardMaterial({ color: BLIMP_COLOR, roughness: BLIMP_ROUGHNESS });
	const mesh = new THREE.InstancedMesh(blimpGeometry(b.len, b.r), material, b.count);
	mesh.name = 'Blimps';
	// The instances move all over the sky; their bounds would need recomputing every frame.
	mesh.frustumCulled = false;
	return mesh;
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

/** Set every instance of `mesh` to its blimpPose at time `t`. */
export function updateBlimps(mesh: THREE.InstancedMesh, b: Blimps, centre: Vec3, t: number): void {
	for (let i = 0; i < mesh.count; i++) {
		const { position, yaw } = blimpPose(i, t, b, centre);
		_position.set(position[0], position[1], position[2]);
		_quaternion.setFromAxisAngle(_up, yaw);
		mesh.setMatrixAt(i, _matrix.compose(_position, _quaternion, _scale));
	}
	mesh.instanceMatrix.needsUpdate = true;
}
