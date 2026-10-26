// Greybox people for the /city hero: figures walking the export's walk paths
// (hero_props.json `walk_paths`: the plaza ring around the well, a closed loop,
// and the avenue pavements, open lines). Spec "Moving things": low-poly,
// instanced, the hundreds at most. Every figure is one capsule body plus a
// head, all in one InstancedMesh with colours from a muted palette. The layout
// is seeded per path index (mulberry32), so every load looks the same.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec3 } from './props.ts';

/** Figures per walk path, desktop and mobile, and their walking speeds (m/s). */
export const PEOPLE_PER_PATH = 40;
export const PEOPLE_PER_PATH_MOBILE = 20;
export const WALK_SPEED: [number, number] = [0.9, 1.5];

/** Figure: body capsule from the ground up, head sphere on top; total height PERSON_HEIGHT. */
const PERSON_HEIGHT = 1.75;
const BODY_RADIUS = 0.2;
const BODY_HEIGHT = 1.45;
const HEAD_RADIUS = 0.13;
const BODY_CAP_SEGMENTS = 2;
const BODY_RADIAL_SEGMENTS = 6;
const HEAD_WIDTH_SEGMENTS = 6;
const HEAD_HEIGHT_SEGMENTS = 4;
/** Per-figure height scale range around PERSON_HEIGHT. */
const SCALE_RANGE: [number, number] = [0.92, 1.06];
/** Sideways spread (m, ±) from the path line, so a path reads as a pavement, not a queue. */
const LATERAL_SPREAD = 0.6;
/** Step bob: amplitude (m) once per stride (m). */
const STEP_BOB_M = 0.035;
const STRIDE_M = 0.75;
/** Muted clothing palette (8). */
const PALETTE = [0x6b5d52, 0x4f5b66, 0x8a7f6e, 0x5e6b58, 0x7a5a55, 0x3f4552, 0x9a9184, 0x6e6478];
const PERSON_ROUGHNESS = 0.85;
/** mulberry32 seed of path `i` is PATH_SEED + i. */
const PATH_SEED = 0x5eed;
/** First and last point closer than this (m) make a closed loop. */
const CLOSED_EPS = 1e-3;

export type WalkerPose = { position: Vec3; heading: number };
export type PeopleOptions = { perPath: number; speed: [number, number] };
/** One figure: its path, start distance s0 (m), speed (m/s, signed by direction), offset and look. */
export type Walker = {
	path: number;
	s0: number;
	speed: number;
	direction: 1 | -1;
	offset: number;
	scale: number;
	color: number;
};
export type People = { mesh: THREE.InstancedMesh; update(t: number): void };

/** mulberry32 PRNG: a function returning uniform floats in [0, 1). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type PathMetric = { cumulative: number[]; length: number; closed: boolean };
const metrics = new WeakMap<Vec3[], PathMetric>();

/** Cumulative segment lengths of `path`, cached per array. */
function metricOf(path: Vec3[]): PathMetric {
	let m = metrics.get(path);
	if (m) return m;
	const cumulative = [0];
	for (let k = 1; k < path.length; k++) {
		const [a, b] = [path[k - 1], path[k]];
		cumulative.push(cumulative[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
	}
	const first = path[0];
	const last = path[path.length - 1];
	const closed =
		path.length > 2 &&
		Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]) < CLOSED_EPS;
	m = { cumulative, length: cumulative[cumulative.length - 1], closed };
	metrics.set(path, m);
	return m;
}

/**
 * Walker at distance `s` (m) along `path`. A closed path (first point == last)
 * wraps; an open one ping-pongs, turning round at each end. heading is a yaw
 * about +Y that turns local +Z, (0, 0, 1), to (sin h, 0, cos h): the walking
 * direction on the xz plane.
 */
export function walkerPose(path: Vec3[], s: number): WalkerPose {
	const { cumulative, length, closed } = metricOf(path);
	if (path.length < 2 || length <= 0) return { position: [...path[0]] as Vec3, heading: 0 };

	let d: number;
	let back = false;
	if (closed) {
		d = ((s % length) + length) % length;
	} else {
		const u = ((s % (2 * length)) + 2 * length) % (2 * length);
		back = u > length;
		d = back ? 2 * length - u : u;
	}

	// Segment k spans cumulative[k]..cumulative[k + 1]; binary search the last start ≤ d.
	let lo = 0;
	let hi = path.length - 2;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (cumulative[mid] <= d) lo = mid;
		else hi = mid - 1;
	}
	const a = path[lo];
	const b = path[lo + 1];
	const seg = cumulative[lo + 1] - cumulative[lo];
	const f = seg > 0 ? (d - cumulative[lo]) / seg : 0;
	const dx = (b[0] - a[0]) * (back ? -1 : 1);
	const dz = (b[2] - a[2]) * (back ? -1 : 1);
	return {
		position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f],
		heading: Math.atan2(dx, dz)
	};
}

/** The seeded layout: `perPath` walkers on each path, path i drawn from mulberry32(PATH_SEED + i). */
export function planWalkers(paths: Vec3[][], opts: PeopleOptions): Walker[] {
	const walkers: Walker[] = [];
	paths.forEach((path, i) => {
		const rand = mulberry32(PATH_SEED + i);
		const { length, closed } = metricOf(path);
		// An open path's cycle is there and back.
		const cycle = closed ? length : 2 * length;
		for (let k = 0; k < opts.perPath; k++) {
			walkers.push({
				path: i,
				// Evenly spread, jittered within each slot.
				s0: (cycle * (k + rand())) / opts.perPath,
				speed: opts.speed[0] + (opts.speed[1] - opts.speed[0]) * rand(),
				// Open paths already walk both ways; loops get a direction each.
				direction: closed && rand() < 0.5 ? -1 : 1,
				offset: (rand() * 2 - 1) * LATERAL_SPREAD,
				scale: SCALE_RANGE[0] + (SCALE_RANGE[1] - SCALE_RANGE[0]) * rand(),
				color: PALETTE[Math.floor(rand() * PALETTE.length)]
			});
		}
	});
	return walkers;
}

/** One figure, feet at y = 0, PERSON_HEIGHT tall. */
function personGeometry(): THREE.BufferGeometry {
	const body = new THREE.CapsuleGeometry(
		BODY_RADIUS,
		BODY_HEIGHT - 2 * BODY_RADIUS,
		BODY_CAP_SEGMENTS,
		BODY_RADIAL_SEGMENTS
	);
	body.translate(0, BODY_HEIGHT / 2, 0);
	const head = new THREE.SphereGeometry(HEAD_RADIUS, HEAD_WIDTH_SEGMENTS, HEAD_HEIGHT_SEGMENTS);
	head.translate(0, PERSON_HEIGHT - HEAD_RADIUS, 0);
	const merged = mergeGeometries([body, head]);
	body.dispose();
	head.dispose();
	if (!merged) throw new Error('people: could not merge the body and head');
	return merged;
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

/** All walkers of `paths` in one InstancedMesh (one draw call); update(t) walks them to time t (s). */
export function createPeople(paths: Vec3[][], opts: PeopleOptions): People {
	const walkers = planWalkers(paths, opts);
	const material = new THREE.MeshStandardMaterial({ roughness: PERSON_ROUGHNESS });
	const mesh = new THREE.InstancedMesh(personGeometry(), material, walkers.length);
	mesh.name = 'People';
	// The figures spread over the whole avenue and move; bounds would need recomputing every frame.
	mesh.frustumCulled = false;
	walkers.forEach((w, k) => mesh.setColorAt(k, _color.setHex(w.color)));

	const update = (t: number): void => {
		walkers.forEach((w, k) => {
			const s = w.s0 + w.direction * w.speed * t;
			const { position, heading } = walkerPose(paths[w.path], s);
			// Lateral offset to the walker's right, (cos h, 0, −sin h) for heading h.
			const bob = STEP_BOB_M * Math.abs(Math.sin((Math.PI * s) / STRIDE_M));
			_position.set(
				position[0] + w.offset * Math.cos(heading),
				position[1] + bob,
				position[2] - w.offset * Math.sin(heading)
			);
			_quaternion.setFromAxisAngle(_up, heading);
			_scale.setScalar(w.scale);
			mesh.setMatrixAt(k, _matrix.compose(_position, _quaternion, _scale));
		});
		mesh.instanceMatrix.needsUpdate = true;
	};
	update(0);
	return { mesh, update };
}
