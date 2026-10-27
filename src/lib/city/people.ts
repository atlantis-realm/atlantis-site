// People for the /city hero: figures walking the export's walk paths
// (hero_props.json `walk_paths`: the avenue pavements, open lines; a path left
// whole as a loop is walked round). No walkers circle the plaza. Spec "Moving things": low-poly,
// instanced, the hundreds at most. The figures are the PSX pack characters
// baked by export_people.py (people.glb: one mesh per variant, WALK_KEYS morph
// targets, one atlas material), one InstancedMesh per variant. Without that glb
// they fall back to greybox capsules (a body plus a head, one InstancedMesh,
// colours from a muted palette). The layout is seeded per path index
// (mulberry32), so every load looks the same. With the baked characters,
// IDLE_PEOPLE more stand still at the export's idle spots (hero_props.json
// `idle_spots`), sitting on a ledge or leaning on a wall in the cast's static
// `sit` / `lean` pose, drawn by the walkers' InstancedMeshes (no extra calls).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { IdleSpot, Vec3 } from './props.ts';

/** Figures per walk path, desktop and mobile, and their walking speeds (m/s). */
export const PEOPLE_PER_PATH = 30;
export const PEOPLE_PER_PATH_MOBILE = 20;
export const WALK_SPEED: [number, number] = [0.9, 1.5];

/** Idle (sitting or leaning) people, desktop and mobile; about SIT_SHARE of them sit. */
export const IDLE_PEOPLE = 40;
export const IDLE_PEOPLE_MOBILE = 20;
export const SIT_SHARE = 0.4;
/** Idle people stand at least this far (m) apart, so a facade gets a few, not a row. */
export const IDLE_GAP = 2;
/** A sitter's seat height (scaled) may miss the spot's drop by this much (m): feet a little short of or into the ground. */
export const SIT_DROP_TOLERANCE = 0.12;
/** Spot order, variant and scale picks of the idle people. */
const IDLE_SEED = 0x1d1e;

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
/** mulberry32 seed of path `i` is PATH_SEED + i; its variant picks come from VARIANT_SEED + i. */
const PATH_SEED = 0x5eed;
const VARIANT_SEED = 0xca57;
/** Pick weight of a uniformed variant (police, firefighter, …) against a civilian's 1, so the street isn't a third uniforms. */
export const UNIFORM_WEIGHT = 0.5;
/** First and last point closer than this (m) make a closed loop. */
const CLOSED_EPS = 1e-3;

export type WalkerPose = { position: Vec3; heading: number };
/** `variantWeights`: relative pick weight per character variant (default: one variant). */
export type PeopleOptions = {
	perPath: number;
	speed: [number, number];
	variantWeights?: number[];
	/** Idle people placed at `idleSpots` (baked characters only; default none). */
	idle?: number;
	idleSpots?: IdleSpot[];
};
/** One figure: its path, start distance s0 (m), speed (m/s), direction, offset and look (colour or character variant). */
export type Walker = {
	path: number;
	s0: number;
	speed: number;
	direction: 1 | -1;
	offset: number;
	scale: number;
	color: number;
	variant: number;
};
/** `meshes`: one InstancedMesh for the capsules, or one per character variant that has walkers. */
export type People = { meshes: THREE.InstancedMesh[]; update(t: number): void; dispose(): void };

/** people_meta.json, written by export_people.py beside people.glb. */
export type PeopleMeta = {
	version: number;
	/** Walk keys (morph targets walk_0…) per cycle. */
	keys: number;
	/** Metres per walk cycle (two steps), mean over the cast. */
	cycle_m: number;
	/** Morph target index of each static pose, after the walk keys (version 2). */
	poses?: { sit: number; lean: number };
	/** Pose measures in the character's frame, forward = its facing (version 2): seat contact above the
	 * soles, ledge edge forward of the origin, wall plane behind the origin. */
	variants: {
		name: string;
		height: number;
		kind: string | null;
		cycle_m?: number;
		sit_seat_h?: number;
		sit_edge?: number;
		lean_back?: number;
	}[];
};
/** A variant's static-pose measures (m, unscaled): see PeopleMeta. */
export type PoseBody = { seatH: number; sitEdge: number; leanBack: number };
/** One character variant: its geometry (with the walk morph targets), the glb node's transform and its cycle (m). */
export type CastMember = {
	name: string;
	geometry: THREE.BufferGeometry;
	matrix: THREE.Matrix4;
	cycleM: number;
	uniform: boolean;
	/** Set when the glb has the static poses. */
	body?: PoseBody;
};
/** `keys` walk keys; `targets` morph targets in all (the walk keys, then the `poses`, if any). */
export type PeopleCast = {
	members: CastMember[];
	material: THREE.Material;
	keys: number;
	targets: number;
	poses?: { sit: number; lean: number };
};
/** One idle person: pose, character variant, height scale and the spot it's placed at. */
export type Idler = { pose: 'sit' | 'lean'; variant: number; scale: number; spot: IdleSpot };
/** Mesh name prefix of the variants in people.glb. */
export const PEOPLE_MESH_PREFIX = 'PEOPLE_';

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
		// Its own stream, so the layout above doesn't change with the number of variants.
		const pick = mulberry32(VARIANT_SEED + i);
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
				color: PALETTE[Math.floor(rand() * PALETTE.length)],
				variant: weightedPick(opts.variantWeights, pick())
			});
		}
	});
	return walkers;
}

/** Index into `weights` that `u` (in [0, 1)) falls in, by cumulative weight; 0 without weights. */
export function weightedPick(weights: number[] | undefined, u: number): number {
	if (!weights || weights.length === 0) return 0;
	const total = weights.reduce((a, w) => a + w, 0);
	let acc = 0;
	for (let k = 0; k < weights.length; k++) {
		acc += weights[k];
		if (u * total < acc) return k;
	}
	return weights.length - 1;
}

/**
 * Walk key shown after `distance` m walked, with `cycle` m per cycle of `keys`
 * keys: floor(phase · keys) for phase = (distance / cycle) mod 1, wrapping.
 */
export function walkKey(distance: number, cycle: number, keys: number): number {
	const phase = (((distance / cycle) % 1) + 1) % 1;
	return Math.min(keys - 1, Math.floor(phase * keys));
}

/**
 * Morph influences for walk key `key` (or static pose target `key`) out of
 * `keys` targets: exactly that key at 1, every other at 0. Stepped on purpose,
 * never blended: the chunky 6-frame walk and the still poses are the look (the
 * robots added later are the fluid ones).
 */
export function walkInfluences(key: number, keys: number, out: number[] = []): number[] {
	out.length = keys;
	for (let k = 0; k < keys; k++) out[k] = k === key ? 1 : 0;
	return out;
}

/** Check people_meta.json's shape (a stale or wrong file fails loudly). */
export function parsePeopleMeta(json: unknown): PeopleMeta {
	const m = json as PeopleMeta;
	if (
		!m ||
		!Number.isInteger(m.keys) ||
		m.keys < 1 ||
		!(m.cycle_m > 0) ||
		!Array.isArray(m.variants) ||
		m.variants.length === 0 ||
		m.variants.some((v) => typeof v?.name !== 'string')
	)
		throw new Error('people_meta.json: needs keys, cycle_m and variants[].name');
	if (
		m.poses !== undefined &&
		(!(Number.isInteger(m.poses?.sit) && Number.isInteger(m.poses?.lean)) ||
			Math.min(m.poses.sit, m.poses.lean) < m.keys ||
			m.variants.some(
				(v) => !(v.sit_seat_h! > 0 && Number.isFinite(v.sit_edge) && Number.isFinite(v.lean_back))
			))
	)
		throw new Error(
			'people_meta.json: poses need sit/lean targets after the keys and per-variant measures'
		);
	return m;
}

/**
 * The cast from people.glb's scene: mesh PEOPLE_<name> for every meta variant,
 * with the node's world transform (the quantized glb puts its dequantizing
 * scale and offset there). Throws when a variant's mesh, morph targets or the
 * shared material are missing.
 */
export function castFromScene(root: THREE.Object3D, meta: PeopleMeta): PeopleCast {
	root.updateMatrixWorld(true);
	let material: THREE.Material | null = null;
	const poses = meta.poses;
	const targets = poses ? Math.max(meta.keys, poses.sit + 1, poses.lean + 1) : meta.keys;
	const members = meta.variants.map((v): CastMember => {
		const mesh = root.getObjectByName(PEOPLE_MESH_PREFIX + v.name) as THREE.Mesh | undefined;
		if (!mesh?.isMesh) throw new Error(`people.glb: no mesh ${PEOPLE_MESH_PREFIX}${v.name}`);
		const found = mesh.geometry.morphAttributes.position?.length ?? 0;
		if (found !== targets)
			throw new Error(`people.glb: ${mesh.name} has ${found} morph targets, not ${targets}`);
		material ??= Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		return {
			name: v.name,
			geometry: mesh.geometry,
			matrix: mesh.matrixWorld.clone(),
			cycleM: v.cycle_m ?? meta.cycle_m,
			uniform: v.kind != null,
			body: poses
				? { seatH: v.sit_seat_h!, sitEdge: v.sit_edge!, leanBack: v.lean_back! }
				: undefined
		};
	});
	if (!material) throw new Error('people.glb: no material');
	return { members, material, keys: meta.keys, targets, poses };
}

/** Pick weights of the cast: civilians 1, uniforms UNIFORM_WEIGHT. */
export function castWeights(cast: PeopleCast): number[] {
	return cast.members.map((m) => (m.uniform ? UNIFORM_WEIGHT : 1));
}

/**
 * Where an idle person stands: a sitter's origin is the ledge edge (spot pos)
 * moved back by the scaled `sitEdge` along its facing, `seatH` below the ledge
 * top; a leaner's is the wall foot moved out by the scaled `leanBack`. The
 * heading is the spot's (walkerPose's yaw: facing (sin h, 0, cos h)).
 */
export function idlerPose(spot: IdleSpot, body: PoseBody, scale: number): WalkerPose {
	const [x, y, z] = spot.pos;
	const fx = Math.sin(spot.heading);
	const fz = Math.cos(spot.heading);
	if (spot.pose === 'sit') {
		const back = body.sitEdge * scale;
		return {
			position: [x - fx * back, y - body.seatH * scale, z - fz * back],
			heading: spot.heading
		};
	}
	const out = body.leanBack * scale;
	return { position: [x + fx * out, y, z + fz * out], heading: spot.heading };
}

/** Whether a sitter's seat height (scaled) matches the spot's drop within SIT_DROP_TOLERANCE. */
export function sitFits(spot: IdleSpot, body: PoseBody, scale: number): boolean {
	return Math.abs((spot.drop ?? 0) - body.seatH * scale) <= SIT_DROP_TOLERANCE;
}

/**
 * The seeded idle layout: up to `count` people at `spots` in a seeded order,
 * round(count · SIT_SHARE) sitting and the rest leaning (leaners fill in when
 * the sits run out, and the other way round), IDLE_GAP apart, each with a
 * weighted variant pick and a height scale. A sit spot whose drop the picked
 * person's seat doesn't fit (sitFits) is skipped.
 */
export function planIdlers(
	spots: IdleSpot[],
	count: number,
	bodies: PoseBody[],
	weights?: number[]
): Idler[] {
	const rand = mulberry32(IDLE_SEED);
	const order = spots.map((_, k) => k);
	for (let k = order.length - 1; k > 0; k--) {
		const j = Math.floor(rand() * (k + 1));
		[order[k], order[j]] = [order[j], order[k]];
	}
	// Each spot's person is drawn up front, so a skip doesn't shift the picks after it.
	const draws = order.map(() => ({
		variant: weightedPick(weights, rand()),
		scale: SCALE_RANGE[0] + (SCALE_RANGE[1] - SCALE_RANGE[0]) * rand()
	}));
	const idlers: Idler[] = [];
	const used = new Set<number>();
	const sits = Math.round(count * SIT_SHARE);
	const want = { sit: sits, lean: count - sits };
	const free = (spot: IdleSpot) =>
		idlers.every(
			(o) => Math.hypot(o.spot.pos[0] - spot.pos[0], o.spot.pos[2] - spot.pos[2]) >= IDLE_GAP
		);
	// First pass keeps the sit/lean mix; the second fills up with whatever is left.
	for (const mix of [true, false]) {
		order.forEach((k, n) => {
			const spot = spots[k];
			if (idlers.length >= count || used.has(k)) return;
			if (mix && idlers.filter((o) => o.pose === spot.pose).length >= want[spot.pose]) return;
			const { variant, scale } = draws[n];
			if (spot.pose === 'sit' && !sitFits(spot, bodies[variant], scale)) return;
			if (!free(spot)) return;
			used.add(k);
			idlers.push({ pose: spot.pose, variant, scale, spot });
		});
	}
	return idlers;
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

/** Matrix of walker `w` at time `t` (s): on its path, offset to its right, turned to its heading, scaled. */
function walkerMatrix(paths: Vec3[][], w: Walker, t: number, bob: boolean, out: THREE.Matrix4) {
	const s = w.s0 + w.direction * w.speed * t;
	const { position, heading } = walkerPose(paths[w.path], s);
	// Lateral offset to the walker's right, (cos h, 0, −sin h) for heading h.
	const lift = bob ? STEP_BOB_M * Math.abs(Math.sin((Math.PI * s) / STRIDE_M)) : 0;
	_position.set(
		position[0] + w.offset * Math.cos(heading),
		position[1] + lift,
		position[2] - w.offset * Math.sin(heading)
	);
	_quaternion.setFromAxisAngle(_up, heading);
	_scale.setScalar(w.scale);
	return out.compose(_position, _quaternion, _scale);
}

/** Greybox fallback: all walkers of `paths` as capsules in one InstancedMesh (one draw call); update(t) walks them to time t (s). */
export function createPeople(paths: Vec3[][], opts: PeopleOptions): People {
	const walkers = planWalkers(paths, opts);
	const material = new THREE.MeshStandardMaterial({ roughness: PERSON_ROUGHNESS });
	const mesh = new THREE.InstancedMesh(personGeometry(), material, walkers.length);
	mesh.name = 'People';
	// The figures spread over the whole avenue and move; bounds would need recomputing every frame.
	mesh.frustumCulled = false;
	walkers.forEach((w, k) => mesh.setColorAt(k, _color.setHex(w.color)));

	const update = (t: number): void => {
		walkers.forEach((w, k) => mesh.setMatrixAt(k, walkerMatrix(paths, w, t, true, _matrix)));
		mesh.instanceMatrix.needsUpdate = true;
	};
	update(0);
	const dispose = (): void => {
		mesh.geometry.dispose();
		material.dispose();
		mesh.dispose();
	};
	return { meshes: [mesh], update, dispose };
}

/**
 * The baked characters: walkers get a cast member by weighted seeded pick, and
 * each member with walkers is one InstancedMesh (one draw call) sharing the
 * atlas material. update(t) moves them as createPeople does, without the
 * capsule's step bob (the walk keys bob the hips), and shows each walker's
 * walk key for the distance it has walked. With `opts.idle` and the cast's
 * poses, the idle people (planIdlers) follow the walkers in their variant's
 * mesh: placed once with their pose key at 1, never touched by update().
 */
export function createCharacterPeople(
	paths: Vec3[][],
	opts: PeopleOptions,
	cast: PeopleCast
): People {
	const weights = castWeights(cast);
	const walkers = planWalkers(paths, { ...opts, variantWeights: weights });
	const { keys, targets, poses } = cast;
	const bodies = cast.members.map((m) => m.body);
	const idlers =
		poses && opts.idle && opts.idleSpots && bodies.every((b) => b)
			? planIdlers(opts.idleSpots, opts.idle, bodies as PoseBody[], weights)
			: [];
	const groups = cast.members
		.map((member, v) => ({
			member,
			walkers: walkers.filter((w) => w.variant === v),
			idlers: idlers.filter((p) => p.variant === v)
		}))
		.filter((g) => g.walkers.length + g.idlers.length > 0)
		.map((g) => {
			const mesh = new THREE.InstancedMesh(
				g.member.geometry,
				cast.material,
				g.walkers.length + g.idlers.length
			);
			mesh.name = `People_${g.member.name}`;
			// The figures spread over the whole avenue and move; bounds would need recomputing every frame.
			mesh.frustumCulled = false;
			// Key shown per instance; −1 forces the first write.
			return { ...g, mesh, shown: new Int8Array(g.walkers.length).fill(-1) };
		});

	const influences = walkInfluences(0, targets);
	// setMorphAt reads only morphTargetInfluences off the object it's given.
	const morph = new THREE.Mesh();
	morph.morphTargetInfluences = influences;

	// The idle people, after the walkers: placed and posed once.
	for (const { member, walkers: ws, idlers: ps, mesh } of groups) {
		ps.forEach((p, k) => {
			const { position, heading } = idlerPose(p.spot, member.body!, p.scale);
			_position.set(...position);
			_quaternion.setFromAxisAngle(_up, heading);
			_scale.setScalar(p.scale);
			mesh.setMatrixAt(
				ws.length + k,
				_matrix.compose(_position, _quaternion, _scale).multiply(member.matrix)
			);
			walkInfluences(poses![p.pose], targets, influences);
			mesh.setMorphAt(ws.length + k, morph);
		});
	}

	const update = (t: number): void => {
		for (const { member, walkers: ws, mesh, shown } of groups) {
			let changed = false;
			ws.forEach((w, k) => {
				walkerMatrix(paths, w, t, false, _matrix);
				mesh.setMatrixAt(k, _matrix.multiply(member.matrix));
				// Distance walked since s0 (always forward, whichever way the walker goes),
				// so walkers start at different phases. Stepped: one key at 1, no blending.
				const key = walkKey(w.s0 + w.speed * t, member.cycleM * w.scale, keys);
				if (key === shown[k]) return;
				shown[k] = key;
				walkInfluences(key, targets, influences);
				mesh.setMorphAt(k, morph);
				changed = true;
			});
			mesh.instanceMatrix.needsUpdate = true;
			if (changed && mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
		}
	};
	update(0);
	const dispose = (): void => {
		for (const { mesh } of groups) mesh.dispose();
		disposeCast(cast);
	};
	return { meshes: groups.map((g) => g.mesh), update, dispose };
}

/** Free the cast's geometries, material and atlas texture. */
export function disposeCast(cast: PeopleCast): void {
	for (const { geometry } of cast.members) geometry.dispose();
	(cast.material as THREE.MeshStandardMaterial).map?.dispose();
	cast.material.dispose();
}
