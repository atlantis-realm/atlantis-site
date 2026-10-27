// People for the /city hero: figures walking the export's walk paths
// (hero_props.json `walk_paths`: the avenue pavements, open lines; a path left
// whole as a loop is walked round). No walkers circle the plaza. Spec "Moving things": low-poly,
// instanced, the hundreds at most. The figures are the PSX pack characters
// baked by export_people.py (people.glb: one mesh per variant, WALK_KEYS morph
// targets, one atlas material), one InstancedMesh per variant. Without that glb
// they fall back to greybox capsules (a body plus a head, one InstancedMesh,
// colours from a muted palette). The layout is seeded per path index
// (mulberry32), so every load looks the same. With the baked characters,
// IDLE_SITTERS and IDLE_LEANERS more stay still at the export's idle spots
// (hero_props.json `idle_spots`), sitting on a ledge, leaning back on a wall or
// forward on a railing in the cast's static `sit` / `lean` / `lean_fwd` pose,
// and CONVO_GROUPS conversations of 2-5 people stand in a circle at the export's
// `talk_spots`, stepping between `stand` and `talk`. All of them are drawn by
// the walkers' InstancedMeshes (no extra calls).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { IdleSpot, TalkSpot, Vec3 } from './props.ts';

/** Figures per walk path, desktop and mobile, and their walking speeds (m/s). */
export const PEOPLE_PER_PATH = 30;
export const PEOPLE_PER_PATH_MOBILE = 20;
export const WALK_SPEED: [number, number] = [0.9, 1.5];

/**
 * Idle people, desktop and mobile: sitters (the 12 and 8 there were) and leaners (a tenth of the 28
 * and 12 there were: a facade of leaners read as a queue).
 */
export const IDLE_SITTERS = 12;
export const IDLE_SITTERS_MOBILE = 8;
export const IDLE_LEANERS = 3;
export const IDLE_LEANERS_MOBILE = 1;
/** Share of the leaners that lean forward on a railing (rounded), where a rail top fits them. */
export const LEAN_FWD_SHARE = 0.5;
/** A forward leaner is scaled (within SCALE_RANGE) so its forearms meet the rail top; it may miss by this much (m). */
export const LEAN_FWD_TOLERANCE = 0.03;
/** Conversation groups at the export's talk spots, of CONVO_SIZE people (inclusive, seeded; v05: 2, 3, 4, 5 round the well). */
export const CONVO_GROUPS = 4;
export const CONVO_SIZE: [number, number] = [2, 5];
/** Neighbours in a conversation circle stand about this far (m) apart; the circle is at least CONVO_MIN_R across. */
const CONVO_GAP = 0.95;
const CONVO_MIN_R = 0.55;
/** Seeded jitter: radius (m, ±), angle round the circle and facing (rad, ±). */
const CONVO_JITTER_R = 0.06;
const CONVO_JITTER_ANGLE = 0.18;
const CONVO_JITTER_FACING = 0.2;
/** Turns per schedule (it loops), each CONVO_TURN_S long with gesture beats of CONVO_BEAT_S (s). */
const CONVO_TURNS = 24;
const CONVO_TURN_S: [number, number] = [2.5, 6];
const CONVO_BEAT_S: [number, number] = [0.5, 1.1];
/** Chance a turn has a second talker (someone chipping in): never more than two at once. */
const CONVO_OVERLAP = 0.3;
const CONVO_SEED = 0xc0b5;
/** Which conversation places go to the minibots (pickBotSlots). */
const BOT_SLOT_SEED = 0xb075;
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
	/** Idle sitters and leaners placed at `idleSpots` (baked characters only; default none). */
	idle?: { sit: number; lean: number };
	idleSpots?: IdleSpot[];
	/** Conversation groups at `talkSpots` (baked characters with stand/talk only; default none). */
	convos?: number;
	talkSpots?: TalkSpot[];
	/** Conversation places handed to the minibots (pickBotSlots): left out here, returned as `slots`. */
	botSlots?: number;
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
/**
 * `meshes`: one InstancedMesh for the capsules, or one per character variant that has walkers;
 * `walkers` the walking layout (the minibots step round them) and `slots` the conversation places
 * left for the minibots (opts.botSlots).
 */
export type People = {
	meshes: THREE.InstancedMesh[];
	update(t: number): void;
	dispose(): void;
	walkers?: Walker[];
	slots?: ConvoMember[];
};

/** people_meta.json, written by export_people.py beside people.glb. */
export type PeopleMeta = {
	version: number;
	/** Walk keys (morph targets walk_0…) per cycle. */
	keys: number;
	/** Metres per walk cycle (two steps), mean over the cast. */
	cycle_m: number;
	/** Morph target index of each static pose, after the walk keys (version 2; lean_fwd, stand, talk version 3). */
	poses?: PosesMeta;
	/** Pose measures in the character's frame, forward = its facing (version 2): seat contact above the
	 * soles, ledge edge forward of the origin, wall plane behind the origin; version 3: the rail's near
	 * face forward of the origin and its top above the soles for the forward lean. */
	variants: {
		name: string;
		height: number;
		kind: string | null;
		cycle_m?: number;
		sit_seat_h?: number;
		sit_edge?: number;
		lean_back?: number;
		lean_fwd_front?: number;
		lean_fwd_top?: number;
	}[];
};
export type PosesMeta = {
	sit: number;
	lean: number;
	lean_fwd?: number;
	stand?: number;
	talk?: number;
};
/** A variant's static-pose measures (m, unscaled): see PeopleMeta. fwdFront/fwdTop with version 3. */
export type PoseBody = {
	seatH: number;
	sitEdge: number;
	leanBack: number;
	fwdFront?: number;
	fwdTop?: number;
};
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
	poses?: PosesMeta;
};
/** One idle person: pose, character variant, height scale and the spot it's placed at. */
export type Idler = {
	pose: 'sit' | 'lean' | 'lean_fwd';
	variant: number;
	scale: number;
	spot: IdleSpot;
};
/** One person in a conversation: character variant, height scale, where it stands and its heading. */
export type ConvoMember = { variant: number; scale: number; position: Vec3; heading: number };
/** One talk turn of a conversation: its start (s, into the loop), length, gesture beat and talkers (1 or 2). */
export type ConvoTurn = { start: number; length: number; beat: number; talkers: number[] };
/** A conversation: its spot, members round it and the looping talk schedule (`period` s long). */
export type Convo = { spot: TalkSpot; members: ConvoMember[]; turns: ConvoTurn[]; period: number };
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
	const more = m.poses && [m.poses.lean_fwd, m.poses.stand, m.poses.talk];
	if (
		more &&
		more.some((k) => k !== undefined) &&
		(!more.every((k) => Number.isInteger(k) && k! >= m.keys) ||
			m.variants.some((v) => !(v.lean_fwd_front! > 0 && v.lean_fwd_top! > 0)))
	)
		throw new Error(
			'people_meta.json: lean_fwd/stand/talk need targets after the keys and per-variant forward lean measures'
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
	const targets = poses
		? Math.max(meta.keys, ...Object.values(poses).map((k) => (k ?? 0) + 1))
		: meta.keys;
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
				? {
						seatH: v.sit_seat_h!,
						sitEdge: v.sit_edge!,
						leanBack: v.lean_back!,
						...(poses.lean_fwd !== undefined
							? { fwdFront: v.lean_fwd_front!, fwdTop: v.lean_fwd_top! }
							: {})
					}
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
 * heading is the spot's (walkerPose's yaw: facing (sin h, 0, cos h)). With
 * `forward`, the leaner turns round to face the rail (heading + π), its origin
 * the scaled `fwdFront` out from the rail's foot.
 */
export function idlerPose(
	spot: IdleSpot,
	body: PoseBody,
	scale: number,
	forward = false
): WalkerPose {
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
	const out = (forward ? body.fwdFront! : body.leanBack) * scale;
	return {
		position: [x + fx * out, y, z + fz * out],
		heading: forward ? spot.heading + Math.PI : spot.heading
	};
}

/**
 * The scale that sets a forward leaner's forearms on the spot's rail top
 * (clamped to SCALE_RANGE), or null when the spot has no rail top, the body
 * has no forward lean, or the clamped scale misses by more than LEAN_FWD_TOLERANCE.
 */
export function leanFwdScale(spot: IdleSpot, body: PoseBody): number | null {
	if (spot.top == null || !(body.fwdTop! > 0)) return null;
	const scale = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], spot.top / body.fwdTop!));
	return Math.abs(body.fwdTop! * scale - spot.top) <= LEAN_FWD_TOLERANCE ? scale : null;
}

/** Whether a sitter's seat height (scaled) matches the spot's drop within SIT_DROP_TOLERANCE. */
export function sitFits(spot: IdleSpot, body: PoseBody, scale: number): boolean {
	return Math.abs((spot.drop ?? 0) - body.seatH * scale) <= SIT_DROP_TOLERANCE;
}

/**
 * The seeded idle layout: up to `want.sit` sitters and `want.lean` leaners at
 * `spots` in a seeded order (neither fills in for the other), each IDLE_GAP
 * from its own kind, with a weighted variant pick and a height scale. A sit
 * spot whose drop the picked person's seat doesn't fit (sitFits) is skipped.
 * Of the leaners, round(want.lean · LEAN_FWD_SHARE) lean forward where a rail
 * top fits the picked person (leanFwdScale, which also sets their scale); any
 * the rails can't take, and the rest, lean back.
 */
export function planIdlers(
	spots: IdleSpot[],
	want: { sit: number; lean: number },
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
	const fwd = Math.round(want.lean * LEAN_FWD_SHARE);
	const left = { sit: want.sit, lean: want.lean - fwd, lean_fwd: fwd };
	// Sitters and leaners keep IDLE_GAP from their own kind only (the ledges and the walls barely
	// meet), so the number of leaners never moves a sitter.
	const placed: Record<IdleSpot['pose'], Idler[]> = { sit: [], lean: [] };
	const free = (spot: IdleSpot) =>
		placed[spot.pose].every(
			(o) => Math.hypot(o.spot.pos[0] - spot.pos[0], o.spot.pos[2] - spot.pos[2]) >= IDLE_GAP
		);
	const place = (spot: IdleSpot, n: number, forwardOk: boolean): void => {
		const { variant, scale } = draws[n];
		const body = bodies[variant];
		let idler: Idler | null = null;
		if (spot.pose === 'sit') {
			if (left.sit > 0 && sitFits(spot, body, scale)) idler = { pose: 'sit', variant, scale, spot };
		} else {
			const fit = forwardOk && left.lean_fwd > 0 ? leanFwdScale(spot, body) : null;
			if (fit !== null) idler = { pose: 'lean_fwd', variant, scale: fit, spot };
			else if (left.lean > 0) idler = { pose: 'lean', variant, scale, spot };
		}
		if (!idler || !free(spot)) return;
		left[idler.pose]--;
		placed[spot.pose].push(idler);
	};
	order.forEach((k, n) => place(spots[k], n, true));
	// Forward leans no rail could take become back leans on the spots left, in the same order.
	left.lean += left.lean_fwd;
	left.lean_fwd = 0;
	const taken = new Set(placed.lean.map((o) => o.spot));
	order.forEach(
		(k, n) => spots[k].pose === 'lean' && !taken.has(spots[k]) && place(spots[k], n, false)
	);
	const rank = new Map(order.map((k, n) => [spots[k], n]));
	return [...placed.sit, ...placed.lean].sort((a, b) => rank.get(a.spot)! - rank.get(b.spot)!);
}

/**
 * The seeded conversations: `groups` of CONVO_SIZE people (inclusive) at
 * distinct talk spots in a seeded order, each a different variant (weighted,
 * while the cast has any left) with a height scale, spaced round a circle
 * about CONVO_GAP apart (at least CONVO_MIN_R radius, inside the spot's
 * radius) and facing its centre, with a little seeded jitter. Each group gets
 * a looping talk schedule of CONVO_TURNS turns (convoTalkers).
 */
export function planConvos(spots: TalkSpot[], groups: number, weights?: number[]): Convo[] {
	const rand = mulberry32(CONVO_SEED);
	const order = spots.map((_, k) => k);
	for (let k = order.length - 1; k > 0; k--) {
		const j = Math.floor(rand() * (k + 1));
		[order[k], order[j]] = [order[j], order[k]];
	}
	const kinds = weights?.length || 1;
	const jitter = () => rand() * 2 - 1;
	return order.slice(0, groups).map((k): Convo => {
		const spot = spots[k];
		const n = CONVO_SIZE[0] + Math.floor(rand() * (CONVO_SIZE[1] - CONVO_SIZE[0] + 1));
		const ring = Math.min(
			spot.radius - 0.35 - CONVO_JITTER_R,
			Math.max(CONVO_MIN_R, CONVO_GAP / (2 * Math.sin(Math.PI / n)))
		);
		const a0 = rand() * 2 * Math.PI;
		const used = new Set<number>();
		const [x, y, z] = spot.pos;
		const members = Array.from({ length: n }, (_, i): ConvoMember => {
			// A fresh variant while the cast has any left (a few tries, so the draws stay seeded).
			let variant = weightedPick(weights, rand());
			for (let t = 0; t < 16 && used.has(variant) && used.size < kinds; t++)
				variant = weightedPick(weights, rand());
			used.add(variant);
			const a = a0 + (2 * Math.PI * i) / n + jitter() * CONVO_JITTER_ANGLE;
			const r = ring + jitter() * CONVO_JITTER_R;
			return {
				variant,
				scale: SCALE_RANGE[0] + (SCALE_RANGE[1] - SCALE_RANGE[0]) * rand(),
				position: [x + r * Math.sin(a), y, z + r * Math.cos(a)],
				// Facing the centre, (−sin a, 0, −cos a), give or take.
				heading: a + Math.PI + jitter() * CONVO_JITTER_FACING
			};
		});
		const turns: ConvoTurn[] = [];
		let start = 0;
		let last = -1;
		for (let t = 0; t < CONVO_TURNS; t++) {
			// A different talker from the last turn's.
			let talker = Math.floor(rand() * (last < 0 ? n : n - 1));
			if (last >= 0 && talker >= last) talker++;
			const talkers = [talker];
			if (n > 2 && rand() < CONVO_OVERLAP)
				talkers.push((talker + 1 + Math.floor(rand() * (n - 1))) % n);
			const length = CONVO_TURN_S[0] + (CONVO_TURN_S[1] - CONVO_TURN_S[0]) * rand();
			const beat = CONVO_BEAT_S[0] + (CONVO_BEAT_S[1] - CONVO_BEAT_S[0]) * rand();
			turns.push({ start, length, beat, talkers });
			start += length;
			last = talker;
		}
		return { spot, members, turns, period: start };
	});
}

/** A conversation place for a minibot: member `member` of conversation `convo`. */
export type BotSlot = { convo: number; member: number };

/**
 * `n` seeded conversation places for the minibots, one per group: the groups
 * of three or more first (so a group keeps two people), then the pairs; in
 * each the member whose nearest neighbour stands furthest off (a mech's arms
 * reach wider than a person's shoulders), ties broken at random.
 */
export function pickBotSlots(convos: Convo[], n: number): BotSlot[] {
	const rand = mulberry32(BOT_SLOT_SEED);
	const order = convos.map((_, k) => k);
	for (let k = order.length - 1; k > 0; k--) {
		const j = Math.floor(rand() * (k + 1));
		[order[k], order[j]] = [order[j], order[k]];
	}
	const big = order.filter((k) => convos[k].members.length >= 3);
	const pairs = order.filter((k) => convos[k].members.length < 3);
	return [...big, ...pairs].slice(0, Math.max(0, n)).map((convo) => {
		const ms = convos[convo].members;
		const room = ms.map((a, k) =>
			Math.min(
				...ms
					.filter((_, j) => j !== k)
					.map((b) => Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]))
			)
		);
		const best = Math.max(...room);
		const roomiest = ms.map((_, k) => k).filter((k) => room[k] >= best - 1e-6);
		return { convo, member: roomiest[Math.floor(rand() * roomiest.length)] };
	});
}

/**
 * Who in conversation `c` shows the `talk` pose at time `t` (s, looping over
 * the schedule): the turn's talkers gesture in stepped beats (talk, talk,
 * stand, …; a second talker a beat out of step), everyone else stands. At
 * most two at once.
 */
export function convoTalkers(c: Convo, t: number): boolean[] {
	const u = ((t % c.period) + c.period) % c.period;
	let lo = 0;
	let hi = c.turns.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (c.turns[mid].start <= u) lo = mid;
		else hi = mid - 1;
	}
	const turn = c.turns[lo];
	const beat = Math.floor((u - turn.start) / turn.beat);
	const out = c.members.map(() => false);
	turn.talkers.forEach((k, i) => (out[k] = (beat + i) % 3 !== 2));
	return out;
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
	return { meshes: [mesh], update, dispose, walkers };
}

/**
 * The baked characters: walkers get a cast member by weighted seeded pick, and
 * each member with walkers is one InstancedMesh (one draw call) sharing the
 * atlas material. update(t) moves them as createPeople does, without the
 * capsule's step bob (the walk keys bob the hips), and shows each walker's
 * walk key for the distance it has walked. With `opts.idle` and the cast's
 * poses, the idle people (planIdlers) follow the walkers in their variant's
 * mesh: placed once with their pose key at 1, never touched by update(). With
 * `opts.convos` and the cast's stand/talk poses, the conversations
 * (planConvos) come last: placed once, update(t) switching each member's key
 * between stand and talk (convoTalkers) only when it changes.
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
	const convos =
		poses?.stand !== undefined && poses.talk !== undefined && opts.convos && opts.talkSpots
			? planConvos(opts.talkSpots, opts.convos, weights)
			: [];
	// The minibots' places, then every other conversation member, with its group and index in it.
	const botSlots = pickBotSlots(convos, opts.botSlots ?? 0);
	const isBot = (c: number, i: number) => botSlots.some((s) => s.convo === c && s.member === i);
	const talkers = convos.flatMap((c, n) =>
		c.members.flatMap((m, i) => (isBot(n, i) ? [] : [{ ...m, convo: c, index: i }]))
	);
	const groups = cast.members
		.map((member, v) => ({
			member,
			walkers: walkers.filter((w) => w.variant === v),
			idlers: idlers.filter((p) => p.variant === v),
			talkers: talkers.filter((p) => p.variant === v)
		}))
		.filter((g) => g.walkers.length + g.idlers.length + g.talkers.length > 0)
		.map((g) => {
			const mesh = new THREE.InstancedMesh(
				g.member.geometry,
				cast.material,
				g.walkers.length + g.idlers.length + g.talkers.length
			);
			mesh.name = `People_${g.member.name}`;
			// The figures spread over the whole avenue and move; bounds would need recomputing every frame.
			mesh.frustumCulled = false;
			// Key shown per walker and per talker; −1 forces the first write.
			return {
				...g,
				mesh,
				shown: new Int8Array(g.walkers.length).fill(-1),
				talking: new Int8Array(g.talkers.length).fill(-1)
			};
		});

	const influences = walkInfluences(0, targets);
	// setMorphAt reads only morphTargetInfluences off the object it's given.
	const morph = new THREE.Mesh();
	morph.morphTargetInfluences = influences;
	const stand = (
		index: number,
		position: Vec3,
		heading: number,
		scale: number,
		member: CastMember,
		mesh: THREE.InstancedMesh
	) => {
		_position.set(...position);
		_quaternion.setFromAxisAngle(_up, heading);
		_scale.setScalar(scale);
		mesh.setMatrixAt(
			index,
			_matrix.compose(_position, _quaternion, _scale).multiply(member.matrix)
		);
	};

	// The idle people, after the walkers, and the conversations after them: placed once; the idle
	// people posed once too.
	for (const { member, walkers: ws, idlers: ps, talkers: cs, mesh } of groups) {
		ps.forEach((p, k) => {
			const { position, heading } = idlerPose(p.spot, member.body!, p.scale, p.pose === 'lean_fwd');
			stand(ws.length + k, position, heading, p.scale, member, mesh);
			walkInfluences(poses![p.pose]!, targets, influences);
			mesh.setMorphAt(ws.length + k, morph);
		});
		cs.forEach((p, k) =>
			stand(ws.length + ps.length + k, p.position, p.heading, p.scale, member, mesh)
		);
	}

	const update = (t: number): void => {
		const now = convos.map((c) => convoTalkers(c, t));
		for (const { member, walkers: ws, idlers: ps, talkers: cs, mesh, shown, talking } of groups) {
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
			cs.forEach((p, k) => {
				const on = now[convos.indexOf(p.convo)][p.index] ? 1 : 0;
				if (on === talking[k]) return;
				talking[k] = on;
				walkInfluences(on ? poses!.talk! : poses!.stand!, targets, influences);
				mesh.setMorphAt(ws.length + ps.length + k, morph);
				changed = true;
			});
			if (ws.length) mesh.instanceMatrix.needsUpdate = true;
			if (changed && mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
		}
	};
	update(0);
	// The first update placed the walkers; flag the idle and conversation matrices placed above too.
	for (const { mesh } of groups) mesh.instanceMatrix.needsUpdate = true;
	const dispose = (): void => {
		for (const { mesh } of groups) mesh.dispose();
		disposeCast(cast);
	};
	return {
		meshes: groups.map((g) => g.mesh),
		update,
		dispose,
		walkers,
		slots: botSlots.map((s) => convos[s.convo].members[s.member])
	};
}

/** Free the cast's geometries, material and atlas texture. */
export function disposeCast(cast: PeopleCast): void {
	for (const { geometry } of cast.members) geometry.dispose();
	(cast.material as THREE.MeshStandardMaterial).map?.dispose();
	cast.material.dispose();
}
