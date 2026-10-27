// The robot for the /city hero: one mech from robot.glb (export_robot.py,
// robot_glb.mjs: a skinned mesh with a 'walk' clip) walking a loop down the
// middle of the avenue, clear of the walkers on the pavements. The loop runs
// round the avenue's axis (the mean of the walk paths): out along one side,
// round a half circle, back along the other and round again, so it never has
// to turn on the spot. Unlike the people's stepped morph walk, its walk is
// played smoothly: the clip time follows the distance walked, so its feet
// don't skate. At night its palette glows faintly (ROBOT_NIGHT_GLOW), so the
// green mech doesn't sink into the dark trees behind it.

import * as THREE from 'three';
import { walkerPose, type WalkerPose } from './people.ts';
import type { Vec3 } from './props.ts';

/**
 * The lane round the avenue axis (m): it starts `start` up the axis from its
 * near (plaza) end, its legs are `length` long and `halfGap` either side of the
 * axis (the end arcs' radius), resampled every `step`. The robot starts `lead`
 * before the end of the back leg, walking toward the plaza.
 */
export const ROBOT_LANE = { start: 10, length: 160, halfGap: 7, step: 20, lead: 12 };
/** Segments of each end arc (half circle). */
export const ROBOT_ARC_SEGMENTS = 16;
/** The heading is the chord from this far (m) behind to this far ahead, so it turns smoothly round the arcs. */
export const ROBOT_TURN_LOOK = 1.5;
/** Emissive strength of the palette (its own colours) at full night, scaled by mixMode's emissive level. */
export const ROBOT_NIGHT_GLOW = 0.15;
/** Name of the robot's walk clip in robot.glb. */
export const ROBOT_WALK_CLIP = 'walk';
/** First and last point of a path closer than this (m) make it a loop, as in people.ts. */
const CLOSED_EPS = 1e-3;

/** robot_meta.json, written by export_robot.py beside robot.glb. */
export type RobotMeta = {
	version: number;
	/** Bind pose height (m). */
	height: number;
	/** Ground distance covered per loop of the walk clip (m). */
	walk_cycle_m: number;
	walk_duration_s: number;
	idle_duration_s?: number;
};

/** `s0`: distance along the loop at t = 0; update(t) walks it to time t (s); setNight(level) sets the glow (mixMode's emissive, 0 by day). */
export type Robot = {
	object: THREE.Group;
	s0: number;
	update(t: number): void;
	setNight(level: number): void;
	dispose(): void;
};

/** Check robot_meta.json's shape (a stale or wrong file fails loudly). */
export function parseRobotMeta(json: unknown): RobotMeta {
	const m = json as RobotMeta;
	if (!m || !(m.height > 0) || !(m.walk_cycle_m > 0) || !(m.walk_duration_s > 0))
		throw new Error('robot_meta.json: needs height, walk_cycle_m and walk_duration_s');
	return m;
}

/** Walk clip time (s, in [0, duration)) after `distance` m walked: one clip loop per walk_cycle_m. */
export function robotWalkTime(
	distance: number,
	meta: RobotMeta,
	duration = meta.walk_duration_s
): number {
	const phase = (((distance / meta.walk_cycle_m) % 1) + 1) % 1;
	return phase * duration;
}

/**
 * The robot's loop (closed: first point == last), or null without at least
 * two open walk paths of the same point count. The avenue axis is their
 * pointwise mean (the export samples every pavement line at the same steps
 * from the plaza), so the lane sits between the pavements, on their ground.
 * Out leg on the axis's right (walkerPose's right, (cos h, 0, −sin h)), far
 * arc, back leg on its left, near arc.
 */
export function robotLoop(paths: Vec3[][]): Vec3[] | null {
	const n = paths[0]?.length ?? 0;
	if (paths.length < 2 || n < 2 || paths.some((p) => p.length !== n || isClosed(p))) return null;
	const axis = Array.from(
		{ length: n },
		(_, k) => [0, 1, 2].map((c) => paths.reduce((a, p) => a + p[k][c], 0) / paths.length) as Vec3
	);
	let axisLength = 0;
	for (let k = 1; k < n; k++) axisLength += dist(axis[k - 1], axis[k]);
	const { start, halfGap, step } = ROBOT_LANE;
	const length = Math.min(ROBOT_LANE.length, axisLength - start);
	if (length < step) return null;

	// The axis every `step` along the lane, with its right-hand side.
	const count = Math.round(length / step) + 1;
	const stations = Array.from({ length: count }, (_, k) => {
		const { position, heading } = walkerPose(axis, start + (length * k) / (count - 1));
		return { c: position, h: heading };
	});
	const at = (c: Vec3, h: number, right: number, ahead: number): Vec3 => [
		c[0] + right * Math.cos(h) + ahead * Math.sin(h),
		c[1],
		c[2] - right * Math.sin(h) + ahead * Math.cos(h)
	];
	// Half circle round station `st` from its right (θ = 0) through `sweep` (ahead +1, behind −1) to its left.
	const arc = (st: { c: Vec3; h: number }, sweep: 1 | -1): Vec3[] =>
		Array.from({ length: ROBOT_ARC_SEGMENTS - 1 }, (_, k) => {
			const theta = (Math.PI * (k + 1)) / ROBOT_ARC_SEGMENTS;
			return at(st.c, st.h, halfGap * Math.cos(theta) * sweep, halfGap * Math.sin(theta) * sweep);
		});
	const near = stations[0];
	const far = stations[count - 1];
	return [
		...stations.map((st) => at(st.c, st.h, halfGap, 0)),
		...arc(far, 1),
		...[...stations].reverse().map((st) => at(st.c, st.h, -halfGap, 0)),
		// Round the near end from the left side back to the right: the same half circle, swept behind.
		...arc(near, -1),
		at(near.c, near.h, halfGap, 0)
	];
}

/**
 * The robot at distance `s` (m) round `loop` (walkerPose wraps a closed path):
 * walkerPose's position, and the heading of the chord from ROBOT_TURN_LOOK
 * behind to ROBOT_TURN_LOOK ahead, so it turns smoothly at the polygon's
 * corners instead of snapping.
 */
export function robotPose(loop: Vec3[], s: number): WalkerPose {
	const { position } = walkerPose(loop, s);
	const a = walkerPose(loop, s - ROBOT_TURN_LOOK).position;
	const b = walkerPose(loop, s + ROBOT_TURN_LOOK).position;
	return { position, heading: Math.atan2(b[0] - a[0], b[2] - a[2]) };
}

/**
 * The robot from robot.glb's `scene` and `animations`, walking the loop of
 * `paths` at walk_cycle_m / walk_duration_s, or null without a walk clip or a
 * loop. The clip is paused and time-driven: update(t) sets its time from the
 * distance walked, so it is as smooth as the frames and freezes with t.
 */
export function createRobot(
	scene: THREE.Object3D,
	animations: THREE.AnimationClip[],
	meta: RobotMeta,
	paths: Vec3[][],
	opts: { shadows: boolean }
): Robot | null {
	const clip = THREE.AnimationClip.findByName(animations, ROBOT_WALK_CLIP);
	const loop = clip && robotLoop(paths);
	if (!clip || !loop) return null;

	const object = new THREE.Group();
	object.name = 'Robot';
	object.add(scene);
	const materials = new Set<THREE.MeshStandardMaterial>();
	scene.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh) return;
		mesh.castShadow = mesh.receiveShadow = opts.shadows;
		for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
			if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial)
				materials.add(m as THREE.MeshStandardMaterial);
	});
	// The palette as its own glow, off by day: set up once, so night only changes the strength.
	for (const m of materials) {
		m.emissiveMap = m.map;
		m.emissive.setRGB(1, 1, 1);
		m.emissiveIntensity = 0;
	}
	const mixer = new THREE.AnimationMixer(scene);
	const action = mixer.clipAction(clip);
	action.play();
	action.paused = true;

	let perimeter = 0;
	for (let k = 1; k < loop.length; k++) perimeter += dist(loop[k - 1], loop[k]);
	const { halfGap, lead } = ROBOT_LANE;
	// The near arc is the loop's last stretch; start `lead` before it, on the back leg.
	const s0 = perimeter - Math.PI * halfGap - lead;
	const speed = meta.walk_cycle_m / meta.walk_duration_s;

	const update = (t: number): void => {
		const s = s0 + speed * t;
		const { position, heading } = robotPose(loop, s);
		object.position.set(...position);
		object.rotation.y = heading;
		action.time = robotWalkTime(s, meta, clip.duration);
		mixer.update(0);
	};
	update(0);
	const setNight = (level: number): void => {
		for (const m of materials) m.emissiveIntensity = ROBOT_NIGHT_GLOW * level;
	};
	const dispose = (): void => {
		mixer.stopAllAction();
		mixer.uncacheRoot(scene);
		scene.traverse((obj) => {
			const mesh = obj as THREE.SkinnedMesh;
			if (!mesh.isMesh) return;
			mesh.geometry.dispose();
			for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
				// emissiveMap is the same texture.
				(m as THREE.MeshStandardMaterial).map?.dispose();
				m.dispose();
			}
			if (mesh.isSkinnedMesh) mesh.skeleton.dispose();
		});
		object.clear();
	};
	return { object, s0, update, setNight, dispose };
}

function dist(a: Vec3, b: Vec3): number {
	return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function isClosed(path: Vec3[]): boolean {
	return path.length > 2 && dist(path[0], path[path.length - 1]) < CLOSED_EPS;
}
