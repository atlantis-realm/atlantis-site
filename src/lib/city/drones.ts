// Delivery drones for the /city hero: DRONE_COUNT procedural low-poly
// quadcopters (no model: a hull, four arms with motors, skids, translucent
// rotor discs spun in steps, PSX style) making deliveries and pickups round the
// view. A trip comes in at cruise height from a point the camera doesn't see,
// over the lowest sky it can find (or takes off from a drop spot out of view),
// flies a curve on down a glide to hover over a drop spot (the export's
// drone_spots: talk-spot centres on the plaza and pavement, roof pads; straight
// down if no glide is clear), and either winches its parcel down onto the spot
// and the empty line back up (a delivery), or lowers its empty line to a parcel
// waiting there, hooks it and winches it up (a pickup); then it climbs and flies
// off out of view, and after a short hidden gap comes back with a new trip.
// Delivered parcels wait on their spots until a pickup collects them, no sooner
// than DRONE_PICKUP_WAIT later; at most DRONE_WAITING_MAX lie about (counting
// those on their way), and a delivery never goes to a spot that holds one.
// Drop spots and waiting parcels the camera sees at the current frame are
// preferred, the near ones more (spotWeight), and so are glides it sees, so
// deliveries and pickups happen in the frame. Cruise height clears the export's
// sky grid (drone_sky: the top of the scene) by DRONE_SKY_CLEAR along both legs,
// the glide by DRONE_GLIDE_CLEAR. The drone leans with its acceleration
// (speeding up, braking, turning) and wobbles a little. Every trip flies one of
// the DRONE_LIVERIES (a pickup that of the parcel it collects): hull, trim, a
// stripe or chevron, rotor guards and motor caps, and the parcel and its tape.
// Picks are seeded per drone (mulberry32), and every pose is a function of the
// scene clock (frozen with reduced motion). All drones share four
// InstancedMeshes (bodies, rotors, parcels and lines, nav lights): 5 draw calls
// by day with shadows, 6 at night (the red / green / white strobe lights, which
// bloom). Liveries cost no draw call: the bodies read their colours from a tiny
// livery texture by a per-instance index, the rotors and parcels from
// per-instance colours.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './people.ts';
import type { DroneSky, DroneSpot, Vec3 } from './props.ts';

/** Drones flying at once. */
export const DRONE_COUNT = 6;
/** Drone i draws its picks from mulberry32(DRONE_SEED + i). */
export const DRONE_SEED = 0xd20e5;
/** A spot is in view when one of its `frames` is within this many frames (the export samples every 5). */
export const DRONE_VIEW_SLACK = 5;
/** Spot weight falls off as the distance (m) from the camera to this power; nearer than DRONE_NEAR_MIN weighs as that. */
export const DRONE_NEAR_POWER = 1;
export const DRONE_NEAR_MIN = 15;
/** Cruise speed range (m/s) and horizontal acceleration (m/s²). */
export const DRONE_SPEED: [number, number] = [10, 14];
export const DRONE_ACCEL = 2.5;
/** Climb and descent speeds (m/s) and their acceleration (m/s²). */
export const DRONE_CLIMB_SPEED = 3;
export const DRONE_DESCENT_SPEED = 2.5;
export const DRONE_VERTICAL_ACCEL = 1.5;
/** Cruise height (m) above a ground drop spot, and above a roof one: [min, max]. */
export const DRONE_CRUISE_AGL: [number, number] = [25, 40];
export const DRONE_ROOF_AGL: [number, number] = [10, 18];
/** Half the drone's span (m), rounded up: the sky grid is read this far either side of its path. */
export const DRONE_RADIUS = 1;
/** Cruise legs stay this far (m) above the sky grid's top of the scene under them. */
export const DRONE_SKY_CLEAR = 8;
/** Entry and exit points: this far (m) from the drop spot horizontally, [min, max]; bearings tried for an unseen one. */
export const DRONE_FAR: [number, number] = [220, 320];
const DRONE_BEARING_TRIES = 12;
/** The cruise curves bow sideways by up to this fraction of their length (either way). */
export const DRONE_BEND = 0.3;
/**
 * The final approach glides down to the hover: DRONE_GLIDE_RATIO metres out per metre lost, DRONE_GLIDE_CLEAR (m)
 * above the sky grid but for the last DRONE_GLIDE_FREE (m) over the spot; DRONE_GLIDE_TRIES bearings tried.
 */
export const DRONE_GLIDE_RATIO = 2.5;
export const DRONE_GLIDE_CLEAR = 3;
export const DRONE_GLIDE_FREE = 8;
const DRONE_GLIDE_TRIES = 8;
/** Drop and take-off spots closer than this (m) to another drone's are busy, so two don't hover side by side. */
export const DRONE_SPOT_GAP = 12;
/** Chance a trip takes off from a drop spot out of view rather than flying in; it must be this far (m) from the drop. */
export const DRONE_TAKEOFF_CHANCE = 0.35;
export const DRONE_TAKEOFF_MIN = 60;
/** Rotors spinning on the ground before take-off (s). */
export const DRONE_SPINUP_S = 1.5;
/** The drone's origin (hull centre) above its skids' soles when landed (m). */
export const DRONE_SKID_H = 0.42;
/** Hull half height: the line leaves the belly this far (m) below the origin. */
export const DRONE_BELLY = 0.08;
/** Hover height (m) of the origin above the drop spot while the parcel is winched down. */
export const DRONE_HOVER_H = 5;
/** Line length (m) the parcel hangs on in flight, and the winch speed (m/s). */
export const DRONE_TETHER = 0.5;
export const DRONE_WINCH_SPEED = 1.2;
/** Pauses (s): stopped above the drop before descending, settling at the hover, the parcel on the ground. */
export const DRONE_STOP_S = 1.2;
export const DRONE_SETTLE_S = 1;
export const DRONE_RELEASE_S = 1;
/** Parcel size (m): width (square) and height. */
export const DRONE_PARCEL_W = 0.34;
export const DRONE_PARCEL_H = 0.28;
/** A delivered parcel can be picked up this long (s) after it is set down: [min, max], per parcel. */
export const DRONE_PICKUP_WAIT: [number, number] = [20, 60];
/** Parcels lying on their spots at most, counting deliveries on their way; past it a drone picks one up or idles. */
export const DRONE_WAITING_MAX = 7;
/** Chance a trip collects a parcel the camera sees (one ready and free) rather than delivering. */
export const DRONE_PICKUP_CHANCE = 0.5;
/** Parcels already lying on spots when the drones start (or start afresh). */
export const DRONE_WAITING_START = 3;
/** Hidden pause (s) of a drone with nothing to do (every spot taken, or too many parcels and none to collect). */
export const DRONE_IDLE_S = 4;
/** Hidden pause (s) between one trip leaving the view and the next: [min, max]. */
export const DRONE_RESPAWN_GAP: [number, number] = [1, 6];
/** Lean: horizontal acceleration over this (m/s²), at most DRONE_TILT_MAX (radians). */
const GRAVITY = 9.81;
export const DRONE_TILT_MAX = 0.4;
/** Time step (s) of the central difference the acceleration is taken from (smooths the lean's onset). */
const TILT_DT = 0.3;
/** Hover wobble: position (m) and lean (radians) amplitudes. */
export const DRONE_WOBBLE_M = 0.06;
export const DRONE_WOBBLE_TILT = 0.03;
/** Rotor spin: steps per second and the angle (radians) of each step, PSX style; neighbours turn opposite ways. */
export const DRONE_ROTOR_STEPS = 24;
const DRONE_ROTOR_STEP_ANGLE = 2.2;
/** Nav light strobe (white): on for DRONE_STROBE_ON of every DRONE_STROBE_PERIOD seconds. */
export const DRONE_STROBE_PERIOD = 1.3;
export const DRONE_STROBE_ON = 0.1;
/**
 * A delivery company's livery (sRGB hex): hull, trim (the waist band, belly and arms), a mark (a stripe down
 * the spine and belly, a chevron on the nose top and belly, or both), rotor guards and motor caps, and its
 * parcels with their tape. Strong hulls and trims: they read against the sky and the white buildings.
 */
export type Livery = {
	name: string;
	hull: number;
	trim: number;
	mark: 'stripe' | 'chevron' | 'both';
	markColour: number;
	caps: number;
	parcel: number;
	tape: number;
};
export const DRONE_LIVERIES: Livery[] = [
	{
		name: 'Tidewater Post',
		hull: 0x1f3d73,
		trim: 0xef7d22,
		mark: 'stripe',
		markColour: 0xf2efe8,
		caps: 0xffc23d,
		parcel: 0xb98a55,
		tape: 0x1f3d73
	},
	{
		name: 'Lantern Express',
		hull: 0xf2c12e,
		trim: 0x26272b,
		mark: 'chevron',
		markColour: 0xd8402b,
		caps: 0x26272b,
		parcel: 0xe9e5dc,
		tape: 0xe0a91c
	},
	{
		name: 'Coral Couriers',
		hull: 0xe0584a,
		trim: 0xf0e6d2,
		mark: 'stripe',
		markColour: 0x23324f,
		caps: 0xf0e6d2,
		parcel: 0xb98a55,
		tape: 0xe0584a
	},
	{
		name: 'Kelpline',
		hull: 0x2f7d4a,
		trim: 0xa9d13f,
		mark: 'chevron',
		markColour: 0xf5d742,
		caps: 0xa9d13f,
		parcel: 0xa77b4a,
		tape: 0x2f7d4a
	},
	{
		name: 'Abyss Freight',
		hull: 0x2b2e35,
		trim: 0x2fc4c8,
		mark: 'chevron',
		markColour: 0xe04f9a,
		caps: 0x2fc4c8,
		parcel: 0x3a3d44,
		tape: 0x2fc4c8
	},
	{
		name: 'Pearl Line',
		hull: 0x6a3fa0,
		trim: 0xe0b54a,
		mark: 'both',
		markColour: 0xf2efe8,
		caps: 0xe0b54a,
		parcel: 0xc9b8e0,
		tape: 0xe0b54a
	},
	{
		name: 'Harbour Hop',
		hull: 0x1f8a8a,
		trim: 0xf07a5a,
		mark: 'chevron',
		markColour: 0xf2efe8,
		caps: 0xf07a5a,
		parcel: 0xb98a55,
		tape: 0x1f8a8a
	},
	{
		name: 'Gullwing',
		hull: 0xf06a1d,
		trim: 0x33363c,
		mark: 'stripe',
		markColour: 0xf2efe8,
		caps: 0xf2efe8,
		parcel: 0xe9e5dc,
		tape: 0xf06a1d
	},
	{
		name: 'Current Mail',
		hull: 0x2c5bd6,
		trim: 0xf5d03a,
		mark: 'chevron',
		markColour: 0xf2efe8,
		caps: 0xf5d03a,
		parcel: 0xf5d03a,
		tape: 0x2c5bd6
	},
	{
		name: 'Saltmarsh & Sons',
		hull: 0x7d2638,
		trim: 0xeadfc8,
		mark: 'stripe',
		markColour: 0xd9a441,
		caps: 0xeadfc8,
		parcel: 0xb98a55,
		tape: 0x7d2638
	}
];
/** The body's livery pieces: a column of the livery texture each (its row is the livery). */
export const LIVERY_PIECES = [
	'hull',
	'trim',
	'spine',
	'bellyStripe',
	'noseChevron',
	'bellyChevron',
	'caps',
	'dark'
] as const;
type Piece = (typeof LIVERY_PIECES)[number];
const piece = (p: Piece): number => LIVERY_PIECES.indexOf(p);
/** The dark parts (motors, skids, camera pod): this grey, the same on every livery. */
const DARK = 0x2a2b2e;

/**
 * Each piece's colour (sRGB hex) in livery `l`, in LIVERY_PIECES order: a mark the livery doesn't have takes
 * the colour of what it lies on (the spine and nose the hull's, the belly marks the trim's).
 */
export function liveryColours(l: Livery): number[] {
	const stripe = l.mark !== 'chevron';
	const chevron = l.mark !== 'stripe';
	return [
		l.hull,
		l.trim,
		stripe ? l.markColour : l.hull,
		stripe ? l.markColour : l.trim,
		chevron ? l.markColour : l.hull,
		chevron ? l.markColour : l.trim,
		l.caps,
		DARK
	];
}

const LINE_COLOUR = 0x222222;
/** Trips planned in one update before giving up and starting afresh (a long-hidden tab). */
const MAX_TRIPS_PER_UPDATE = 100;

/** A trip segment: a move along `path` (eased to rest at both ends) or, with one point, a hold. */
type Segment = {
	/** Start time (s) from the trip's start, and its length (s). */
	t0: number;
	dur: number;
	path: Vec3[];
	cum: number[];
	len: number;
	speed: number;
	accel: number;
	/** Heading along the path (cruise), or turned from yaw0 to yaw1 over the segment. */
	follow: boolean;
	yaw0: number;
	yaw1: number;
	/** Line length (m) at the start and end (by distance moved, or by time for a hold). */
	tether0: number;
	tether1: number;
	/** Whether the parcel is on the line or on the drop spot. */
	dropped: boolean;
	/** Wobble on (in the air) or off (on the ground). */
	wobble: boolean;
};

/** One delivery or pickup (or a hidden idle spell): its segments, timed from `start` (s, scene clock) to `end`. */
export type DroneTrip = {
	kind: 'delivery' | 'pickup' | 'idle';
	start: number;
	end: number;
	/** Index of the drop spot (where it sets the parcel down or picks it up; -1 idle), and of the take-off spot (-1: flew in). */
	drop: number;
	takeoff: number;
	/** Index into DRONE_LIVERIES: the drone's and its parcel's. */
	livery: number;
	/** A delivery's parcel can be picked up from this time (s, scene clock); Infinity for a pickup. */
	ready: number;
	/** Cruise height (m, absolute). */
	alt: number;
	/** The parcel's heading on the ground (a delivery's: the drone's on arrival). */
	dropYaw: number;
	/** Wobble phase (radians), per trip. */
	phase: number;
	segments: Segment[];
};

export type DronePose = {
	position: Vec3;
	/** Yaw about +Y turning the nose (+Z) to the facing, as walkerPose. */
	heading: number;
	/** The lean: horizontal acceleration over g, [x, z] (the drone's up is (x, 1, z) normalised). */
	tilt: [number, number];
	/** Line length (m) below the belly. */
	tether: number;
	/** The parcel's centre: on the line, or on the drop spot (dropped: delivered, or not yet picked up). */
	parcel: Vec3;
	dropped: boolean;
};

/** Everything planTrip needs; `seen(p)` says whether the camera sees world point p now (none: nothing is seen). */
export type TripPlan = {
	spots: DroneSpot[];
	sky?: DroneSky;
	rand: () => number;
	start: number;
	frame: number;
	busy: Set<number>;
	eye?: Vec3;
	seen?: (p: Vec3) => boolean;
	/** Livery index to avoid (the drone's last). */
	lastLivery?: number;
	/** Spots no delivery may go to or take off from (holding a parcel, or another drone's); none if absent. */
	taken?: Set<number>;
	/** Collect this waiting parcel instead of delivering: a pickup. */
	pickup?: WaitingParcel;
};

/** A parcel lying on drop spot `spot`, turned `yaw`, of livery `livery`; it can be picked up from time `ready` (s). */
export type WaitingParcel = { spot: number; yaw: number; livery: number; ready: number };

/** Sky grid height (m) at (x, z), clamped to the grid's edge cells. */
export function skyHeight(sky: DroneSky, x: number, z: number): number {
	const i = THREE.MathUtils.clamp(Math.floor((x - sky.origin[0]) / sky.cell), 0, sky.nx - 1);
	const j = THREE.MathUtils.clamp(Math.floor((z - sky.origin[1]) / sky.cell), 0, sky.nz - 1);
	return sky.h[j * sky.nx + i];
}

/**
 * The highest sky grid height within DRONE_RADIUS of the polyline `pts` (in x, z), -Infinity without a grid:
 * points every 2·DRONE_RADIUS along it, each with the cells under the corners of its ±DRONE_RADIUS square, so
 * the squares cover the line and a cell it only clips at a corner still counts.
 */
export function skyMaxAlong(sky: DroneSky | undefined, pts: Vec3[]): number {
	if (!sky) return -Infinity;
	let top = -Infinity;
	const r = DRONE_RADIUS;
	for (let k = 0; k < pts.length; k++) {
		const a = pts[k];
		const b = pts[Math.min(k + 1, pts.length - 1)];
		const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / (2 * r)));
		for (let s = 0; s <= n; s++) {
			const x = a[0] + ((b[0] - a[0]) * s) / n;
			const z = a[2] + ((b[2] - a[2]) * s) / n;
			for (const [dx, dz] of CORNERS) top = Math.max(top, skyHeight(sky, x + dx * r, z + dz * r));
		}
	}
	return top;
}

const CORNERS = [
	[-1, -1],
	[1, -1],
	[-1, 1],
	[1, 1]
];

/** Time (s) to move `len` m from rest to rest: accelerate at `accel` up to `speed`, cruise, brake. */
export function moveDuration(len: number, speed: number, accel: number): number {
	if (len <= 0) return 0;
	const ramp = (speed * speed) / accel; // distance spent speeding up and braking at full speed
	if (len <= ramp) return 2 * Math.sqrt(len / accel);
	return 2 * (speed / accel) + (len - ramp) / speed;
}

/** Distance (m) covered `u` s into moveDuration's move, clamped to [0, len]. */
export function easedDistance(u: number, len: number, speed: number, accel: number): number {
	const total = moveDuration(len, speed, accel);
	if (len <= 0 || u <= 0) return 0;
	if (u >= total) return len;
	const vmax = Math.min(speed, Math.sqrt(len * accel));
	const ta = vmax / accel;
	if (u < ta) return 0.5 * accel * u * u;
	const back = total - u;
	if (back < ta) return len - 0.5 * accel * back * back;
	return 0.5 * accel * ta * ta + vmax * (u - ta);
}

/** Whether camera frame `frame` sees a drone over `spot`: one of its frames within DRONE_VIEW_SLACK. */
export function spotInView(spot: DroneSpot, frame: number): boolean {
	return spot.frames.some((f) => Math.abs(f - frame) <= DRONE_VIEW_SLACK);
}

/** How strongly to prefer `spot` seen from `eye`: 1 / d^DRONE_NEAR_POWER, d at least DRONE_NEAR_MIN. */
export function spotWeight(spot: DroneSpot, eye: Vec3): number {
	return Math.max(dist(spot.pos, eye), DRONE_NEAR_MIN) ** -DRONE_NEAR_POWER;
}

/**
 * A random drop spot index: among the spots not `taken` (-1 if every one is),
 * those not `busy` (all if every one is), the ones in view at `frame` if any;
 * weighted by spotWeight from `eye` when given, else evenly.
 */
export function pickSpot(
	spots: DroneSpot[],
	frame: number,
	rand: () => number,
	busy: Set<number>,
	eye?: Vec3,
	taken?: Set<number>
): number {
	const open = spots.map((_, k) => k).filter((k) => !taken?.has(k));
	if (!open.length) return -1;
	let free = open.filter((k) => !busy.has(k));
	if (!free.length) free = open;
	const seen = free.filter((k) => spotInView(spots[k], frame));
	const pool = seen.length ? seen : free;
	const weights = pool.map((k) => (eye ? spotWeight(spots[k], eye) : 1));
	let r = rand() * weights.reduce((a, b) => a + b, 0);
	for (let k = 0; k < pool.length; k++) if ((r -= weights[k]) < 0) return pool[k];
	return pool[pool.length - 1];
}

/** Heading (as walkerPose) of the horizontal direction from a to b. */
function headingOf(a: Vec3, b: Vec3): number {
	return Math.atan2(b[0] - a[0], b[2] - a[2]);
}

/** `n` + 1 points of the quadratic Bezier a → c → b. */
function bezier(a: Vec3, c: Vec3, b: Vec3, n = 24): Vec3[] {
	const out: Vec3[] = [];
	for (let k = 0; k <= n; k++) {
		const u = k / n;
		const p = (i: number): number =>
			(1 - u) * (1 - u) * a[i] + 2 * u * (1 - u) * c[i] + u * u * b[i];
		out.push([p(0), p(1), p(2)]);
	}
	return out;
}

/** A horizontal curve from a to b at height y, bowed sideways by `bend` of its length. */
function cruiseCurve(a: Vec3, b: Vec3, y: number, bend: number): Vec3[] {
	const dx = b[0] - a[0];
	const dz = b[2] - a[2];
	const c: Vec3 = [(a[0] + b[0]) / 2 - dz * bend, y, (a[2] + b[2]) / 2 + dx * bend];
	return bezier([a[0], y, a[2]], c, [b[0], y, b[2]]);
}

function cumulative(path: Vec3[]): number[] {
	const cum = [0];
	for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + dist(path[k - 1], path[k]));
	return cum;
}

/** The point `s` m along `path` (cumulative lengths `cum`), clamped to its ends. */
function pointAt(path: Vec3[], cum: number[], s: number): Vec3 {
	if (path.length === 1 || s <= 0) return [...path[0]] as Vec3;
	const len = cum[cum.length - 1];
	if (s >= len) return [...path[path.length - 1]] as Vec3;
	let k = 1;
	while (cum[k] < s) k++;
	const u = (s - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
	const a = path[k - 1];
	const b = path[k];
	return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Angle b - a wrapped to (−π, π]. */
function angleDiff(b: number, a: number): number {
	return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * An entry or exit point DRONE_FAR m from `centre` at height y: of DRONE_BEARING_TRIES random bearings, the
 * one the camera doesn't see with the lowest sky (skyMaxAlong) on the straight line to `centre`, so the
 * cruise can stay low (over the open avenue, not the rooftops) where the camera sees it; if every one is seen,
 * the lowest of those.
 */
export function farPoint(
	centre: Vec3,
	y: number,
	rand: () => number,
	seen: (p: Vec3) => boolean,
	sky?: DroneSky
): Vec3 {
	let best: Vec3 = centre;
	let bestScore = Infinity;
	for (let k = 0; k < DRONE_BEARING_TRIES; k++) {
		const a = rand() * 2 * Math.PI;
		const far = DRONE_FAR[0] + rand() * (DRONE_FAR[1] - DRONE_FAR[0]);
		const p: Vec3 = [centre[0] + far * Math.sin(a), y, centre[2] + far * Math.cos(a)];
		const score = (seen(p) ? 1e6 : 0) + Math.max(0, skyMaxAlong(sky, [p, centre]));
		if (score < bestScore) {
			best = p;
			bestScore = score;
		}
	}
	return best;
}

/**
 * Whether the straight glide from `q` down to `hover` stays DRONE_GLIDE_CLEAR above the sky grid (within
 * DRONE_RADIUS), except its last DRONE_GLIDE_FREE m over the drop spot (whose column the export checked).
 */
export function glideClear(sky: DroneSky | undefined, q: Vec3, hover: Vec3): boolean {
	if (!sky) return true;
	const run = Math.hypot(hover[0] - q[0], hover[2] - q[2]);
	const n = Math.max(1, Math.ceil(run / (2 * DRONE_RADIUS)));
	for (let k = 0; k <= n; k++) {
		const u = k / n;
		if (run * (1 - u) < DRONE_GLIDE_FREE) break;
		const p: Vec3 = [
			q[0] + (hover[0] - q[0]) * u,
			q[1] + (hover[1] - q[1]) * u,
			q[2] + (hover[2] - q[2]) * u
		];
		if (skyMaxAlong(sky, [p]) + DRONE_GLIDE_CLEAR > p[1]) return false;
	}
	return true;
}

/**
 * Where a glide in to `hover` starts, at cruise height `alt`: DRONE_GLIDE_RATIO times the height to lose out,
 * on the first of DRONE_GLIDE_TRIES bearings (evenly round from a random one) whose glide is clear
 * (glideClear) and seen half way down, else the first clear one; null if none is.
 */
export function pickGlide(
	hover: Vec3,
	alt: number,
	sky: DroneSky | undefined,
	rand: () => number,
	seen: (p: Vec3) => boolean
): Vec3 | null {
	const run = DRONE_GLIDE_RATIO * (alt - hover[1]);
	const a0 = rand() * 2 * Math.PI;
	if (run <= DRONE_GLIDE_FREE) return null;
	let fallback: Vec3 | null = null;
	for (let k = 0; k < DRONE_GLIDE_TRIES; k++) {
		const a = a0 + (2 * Math.PI * k) / DRONE_GLIDE_TRIES;
		const q: Vec3 = [hover[0] + run * Math.sin(a), alt, hover[2] + run * Math.cos(a)];
		if (!glideClear(sky, q, hover)) continue;
		const mid: Vec3 = [(q[0] + hover[0]) / 2, (q[1] + hover[1]) / 2, (q[2] + hover[2]) / 2];
		if (seen(mid)) return q;
		fallback ??= q;
	}
	return fallback;
}

/** `yaw` turned by a multiple of a quarter turn to lie nearest `ref`: a square parcel looks the same. */
export function squareYawNear(yaw: number, ref: number): number {
	return yaw + Math.round(angleDiff(ref, yaw) / (Math.PI / 2)) * (Math.PI / 2);
}

/**
 * A delivery setting off at `start` (or, with `plan.pickup`, a pickup: the
 * same flight to the parcel's spot, in its livery, carrying nothing in; then
 * the hover turning square to the parcel, the empty line lowered to it, a
 * hook, the parcel winched up to DRONE_TETHER and carried out): a drop spot
 * (pickSpot, never a `taken` one), then either a
 * take-off from an unseen spot DRONE_TAKEOFF_MIN away (DRONE_TAKEOFF_CHANCE)
 * or an unseen entry point DRONE_FAR out; a cruise curve at a height
 * clearing the sky grid along both legs by DRONE_SKY_CLEAR (and the drop by
 * DRONE_CRUISE_AGL / DRONE_ROOF_AGL) running on, without a stop, down a glide
 * to DRONE_HOVER_H over the drop (pickGlide; the camera sees it if it can), or,
 * if no glide is clear, to above the drop, a stop and the descent; the parcel winched down to the spot and left there, the empty
 * line winched up, the climb (turning to the way out) and a cruise curve to an
 * unseen exit point.
 */
export function planTrip(plan: TripPlan): DroneTrip {
	const { spots, sky, rand, busy } = plan;
	const seen = plan.seen ?? (() => false);
	const range = (r: [number, number]): number => r[0] + rand() * (r[1] - r[0]);
	const pickup = plan.pickup;
	const drop = pickup ? pickup.spot : pickSpot(spots, plan.frame, rand, busy, plan.eye, plan.taken);
	if (drop < 0) throw new Error('drones: every drop spot is taken');
	const d = spots[drop].pos;
	const roof = spots[drop].kind === 'roof';
	const agl = range(roof ? DRONE_ROOF_AGL : DRONE_CRUISE_AGL);
	const speed = range(DRONE_SPEED);
	let livery = pickup?.livery ?? Math.floor(rand() * DRONE_LIVERIES.length);
	if (!pickup && livery === plan.lastLivery) livery = (livery + 1) % DRONE_LIVERIES.length;

	let takeoff = -1;
	if (rand() < DRONE_TAKEOFF_CHANCE) {
		const pool = spots
			.map((_, k) => k)
			.filter(
				(k) =>
					k !== drop &&
					!busy.has(k) &&
					!plan.taken?.has(k) &&
					!spotInView(spots[k], plan.frame) &&
					Math.hypot(spots[k].pos[0] - d[0], spots[k].pos[2] - d[2]) >= DRONE_TAKEOFF_MIN
			);
		if (pool.length) takeoff = pool[Math.floor(rand() * pool.length)];
	}
	const guess = d[1] + agl;
	const from = takeoff >= 0 ? spots[takeoff].pos : farPoint(d, guess, rand, seen, sky);
	const to = farPoint(d, guess, rand, seen, sky);
	const bendIn = (rand() * 2 - 1) * DRONE_BEND;
	const bendOut = (rand() * 2 - 1) * DRONE_BEND;
	const hover: Vec3 = [d[0], d[1] + DRONE_HOVER_H, d[2]];
	const clearAlt = (pts: Vec3[]): number => skyMaxAlong(sky, pts) + DRONE_SKY_CLEAR;
	let alt = Math.max(guess, clearAlt([from, d]), clearAlt(cruiseCurve(d, to, 0, bendOut)));
	if (takeoff >= 0) alt = Math.max(alt, from[1] + DRONE_ROOF_AGL[0]);
	// A glide in if one clears the sky (a seen one first): the cruise curve ends along it, so the drone
	// flies on down it without stopping; else the curve ends over the drop and the drone descends straight.
	let inbound: Vec3[];
	const glide = pickGlide(hover, alt, sky, rand, seen);
	if (glide) {
		const q = glide;
		const ux = (d[0] - q[0]) / Math.hypot(d[0] - q[0], d[2] - q[2]);
		const uz = (d[2] - q[2]) / Math.hypot(d[0] - q[0], d[2] - q[2]);
		const k = Math.hypot(q[0] - from[0], q[2] - from[2]) / 2;
		const curve = (y: number): Vec3[] =>
			bezier([from[0], y, from[2]], [q[0] - ux * k, y, q[2] - uz * k], [q[0], y, q[2]]);
		// Higher only steepens the glide, which keeps it clear.
		alt = Math.max(alt, clearAlt(curve(0)));
		inbound = [...curve(alt), hover];
	} else {
		alt = Math.max(alt, clearAlt(cruiseCurve(from, d, 0, bendIn)));
		inbound = cruiseCurve(from, d, alt, bendIn);
	}
	const outbound = cruiseCurve(d, to, alt, bendOut);

	const segments: Segment[] = [];
	let t = 0;
	const add = (
		path: Vec3[],
		o: Partial<Segment> & { dur?: number; speed?: number; accel?: number }
	): Segment => {
		const cum = cumulative(path);
		const len = cum[cum.length - 1];
		const speedK = o.speed ?? 1;
		const accelK = o.accel ?? 1;
		const dur = path.length > 1 ? moveDuration(len, speedK, accelK) : (o.dur ?? 0);
		const yaw0 = o.yaw0 ?? 0;
		const seg: Segment = {
			t0: t,
			dur,
			path,
			cum,
			len,
			speed: speedK,
			accel: accelK,
			follow: o.follow ?? false,
			yaw0,
			yaw1: o.yaw1 ?? yaw0,
			tether0: o.tether0 ?? DRONE_TETHER,
			tether1: o.tether1 ?? o.tether0 ?? DRONE_TETHER,
			dropped: o.dropped ?? false,
			wobble: o.wobble ?? true
		};
		segments.push(seg);
		t += dur;
		return seg;
	};

	const yawIn = headingOf(inbound[0], inbound[1]);
	const yawArrive = headingOf(inbound[inbound.length - 2], inbound[inbound.length - 1]);
	const low = DRONE_HOVER_H - DRONE_BELLY - DRONE_PARCEL_H;
	const yawLeave = headingOf(outbound[0], outbound[1]);
	// A pickup flies in with no line out and the parcel on its spot; it hovers square to the parcel.
	const fly = pickup ? { tether0: 0, dropped: true } : {};
	const yawPark = pickup ? squareYawNear(pickup.yaw, yawArrive) : yawArrive;
	if (takeoff >= 0) {
		const ground: Vec3 = [from[0], from[1] + DRONE_SKID_H, from[2]];
		add([ground], { dur: DRONE_SPINUP_S, yaw0: yawIn, ...fly, tether0: 0, wobble: false });
		add([ground, inbound[0]], {
			speed: DRONE_CLIMB_SPEED,
			accel: DRONE_VERTICAL_ACCEL,
			yaw0: yawIn,
			...fly,
			tether0: 0,
			tether1: pickup ? 0 : DRONE_TETHER
		});
	}
	add(inbound, { speed, accel: DRONE_ACCEL, follow: true, ...fly });
	if (!glide) {
		const top = inbound[inbound.length - 1];
		add([top], { dur: DRONE_STOP_S, yaw0: yawArrive, ...fly });
		add([top, hover], {
			speed: DRONE_DESCENT_SPEED,
			accel: DRONE_VERTICAL_ACCEL,
			yaw0: yawArrive,
			...fly
		});
	}
	add([hover], { dur: DRONE_SETTLE_S, yaw0: yawArrive, yaw1: yawPark, ...fly });
	let release = 0;
	if (pickup) {
		add([hover], {
			dur: low / DRONE_WINCH_SPEED,
			yaw0: yawPark,
			tether0: 0,
			tether1: low,
			dropped: true
		});
		add([hover], { dur: DRONE_RELEASE_S, yaw0: yawPark, tether0: low, dropped: true });
		add([hover], {
			dur: (low - DRONE_TETHER) / DRONE_WINCH_SPEED,
			yaw0: yawPark,
			tether0: low,
			tether1: DRONE_TETHER
		});
		add([hover, outbound[0]], {
			speed: DRONE_CLIMB_SPEED,
			accel: DRONE_VERTICAL_ACCEL,
			yaw0: yawPark,
			yaw1: yawLeave
		});
		add(outbound, { speed, accel: DRONE_ACCEL, follow: true });
	} else {
		const winch = (low - DRONE_TETHER) / DRONE_WINCH_SPEED;
		add([hover], { dur: winch, yaw0: yawArrive, tether0: DRONE_TETHER, tether1: low });
		release = add([hover], {
			dur: DRONE_RELEASE_S,
			yaw0: yawArrive,
			tether0: low,
			dropped: true
		}).t0;
		add([hover], {
			dur: low / DRONE_WINCH_SPEED,
			yaw0: yawArrive,
			tether0: low,
			tether1: 0,
			dropped: true
		});
		add([hover, outbound[0]], {
			speed: DRONE_CLIMB_SPEED,
			accel: DRONE_VERTICAL_ACCEL,
			yaw0: yawArrive,
			yaw1: yawLeave,
			tether0: 0,
			dropped: true
		});
		add(outbound, { speed, accel: DRONE_ACCEL, follow: true, tether0: 0, dropped: true });
	}

	const phase = rand() * 2 * Math.PI;
	return {
		kind: pickup ? 'pickup' : 'delivery',
		start: plan.start,
		end: plan.start + t,
		drop,
		takeoff,
		livery,
		ready: pickup ? Infinity : plan.start + release + range(DRONE_PICKUP_WAIT),
		alt,
		dropYaw: pickup ? pickup.yaw : yawArrive,
		phase,
		segments
	};
}

/** The segment holding trip time `u` (clamped to the trip). */
function segmentAt(trip: DroneTrip, u: number): Segment {
	const segs = trip.segments;
	let k = 0;
	while (k < segs.length - 1 && u >= segs[k].t0 + segs[k].dur) k++;
	return segs[k];
}

/** Where the trip's path puts the drone at scene time t (no wobble), and how far along its segment. */
function basePosition(trip: DroneTrip, t: number): { seg: Segment; p: Vec3; s: number; f: number } {
	const u = THREE.MathUtils.clamp(t - trip.start, 0, trip.end - trip.start);
	const seg = segmentAt(trip, u);
	const v = u - seg.t0;
	if (seg.path.length === 1)
		return { seg, p: [...seg.path[0]] as Vec3, s: 0, f: seg.dur > 0 ? v / seg.dur : 1 };
	const s = easedDistance(v, seg.len, seg.speed, seg.accel);
	return { seg, p: pointAt(seg.path, seg.cum, s), s, f: seg.len > 0 ? s / seg.len : 1 };
}

/**
 * The drone at scene time t (clamped to the trip): position (with a small
 * wobble in the air), heading (along a cruise curve, else turned over the
 * segment), the lean from its acceleration (a central difference over
 * TILT_DT, capped at DRONE_TILT_MAX, plus a wobble), the line length and the
 * parcel: hanging below the belly, never below the drop spot, or on it.
 */
export function tripPose(trip: DroneTrip, t: number, spots: DroneSpot[]): DronePose {
	const { seg, p, s, f } = basePosition(trip, t);
	let heading: number;
	if (seg.follow) {
		const a = pointAt(seg.path, seg.cum, Math.max(0, s - 2));
		const b = pointAt(seg.path, seg.cum, Math.min(seg.len, s + 2));
		heading = headingOf(a, b);
	} else {
		heading = seg.yaw0 + angleDiff(seg.yaw1, seg.yaw0) * THREE.MathUtils.smoothstep(f, 0, 1);
	}
	const prev = basePosition(trip, t - TILT_DT).p;
	const next = basePosition(trip, t + TILT_DT).p;
	const h2 = TILT_DT * TILT_DT * GRAVITY;
	let tx = (prev[0] + next[0] - 2 * p[0]) / h2;
	let tz = (prev[2] + next[2] - 2 * p[2]) / h2;
	const cap = Math.tan(DRONE_TILT_MAX);
	const mag = Math.hypot(tx, tz);
	if (mag > cap) {
		tx *= cap / mag;
		tz *= cap / mag;
	}
	if (seg.wobble) {
		const w = t + trip.phase;
		p[0] += DRONE_WOBBLE_M * Math.sin(1.3 * w);
		p[1] += 0.5 * DRONE_WOBBLE_M * Math.sin(0.9 * w + 1);
		p[2] += DRONE_WOBBLE_M * Math.sin(1.1 * w + 2);
		tx += DRONE_WOBBLE_TILT * Math.sin(1.7 * w + 0.5);
		tz += DRONE_WOBBLE_TILT * Math.sin(1.5 * w + 1.5);
	}
	const tether = seg.tether0 + (seg.tether1 - seg.tether0) * f;
	const d = spots[trip.drop].pos;
	const rest = d[1] + DRONE_PARCEL_H / 2;
	let parcel: Vec3 = [p[0], p[1] - DRONE_BELLY - tether - DRONE_PARCEL_H / 2, p[2]];
	// Over the drop spot the parcel never sinks into it (the hover wobbles).
	if (Math.hypot(p[0] - d[0], p[2] - d[2]) < 1) parcel[1] = Math.max(parcel[1], rest);
	if (seg.dropped) parcel = [d[0], rest, d[2]];
	return { position: p, heading, tilt: [tx, tz], tether, parcel, dropped: seg.dropped };
}

/** One drone's current trip, for tests and debugging. */
export type DroneState = {
	visible: boolean;
	kind: DroneTrip['kind'];
	drop: number;
	takeoff: number;
	livery: number;
	position: Vec3;
	/** The parcel is on the drop spot: delivered, or not yet picked up. */
	dropped: boolean;
};

/**
 * update(t, frame, eye, seen) flies every drone to time t (s), planning new
 * trips at camera frame `frame` (drop spots and waiting parcels in view, the
 * near ones from the camera's world position `eye` more) with entry and exit
 * points `seen(p)` says the camera doesn't see. waiting() lists the parcels
 * lying on their spots for a pickup (not those under a drone's own trip).
 */
export type Drones = {
	object: THREE.Group;
	update(t: number, frame: number, eye?: Vec3, seen?: (p: Vec3) => boolean): void;
	state(): DroneState[];
	waiting(): WaitingParcel[];
	setNight(level: number): void;
	dispose(): void;
};

/** Motor centres (m, nose +Z): an X frame, DRONE_ARM out on the diagonals. */
const DRONE_ARM = 0.5;
const MOTORS: Vec3[] = [
	[DRONE_ARM, 0.05, DRONE_ARM],
	[-DRONE_ARM, 0.05, DRONE_ARM],
	[-DRONE_ARM, 0.05, -DRONE_ARM],
	[DRONE_ARM, 0.05, -DRONE_ARM]
];
const ROTOR_R = 0.34;
const ROTOR_Y = 0.12;
/** Nav lights: red on the port (left, +X) front motor, green on the starboard one, white strobe on the tail. */
const LIGHTS: { at: Vec3; colour: [number, number, number] }[] = [
	{ at: [DRONE_ARM + 0.08, 0.05, DRONE_ARM + 0.08], colour: [9, 0.3, 0.2] },
	{ at: [-DRONE_ARM - 0.08, 0.05, DRONE_ARM + 0.08], colour: [0.3, 5, 0.8] },
	{ at: [0, 0.02, -0.32], colour: [7, 7, 7] }
];
const LINE_W = 0.025;
/** Rotor guard ring width (m). */
const ROTOR_GUARD_W = 0.04;

/** A box part with a flat vertex colour (1: the livery texture's colour as is) and its livery piece. */
function part(
	w: number,
	h: number,
	l: number,
	at: Vec3,
	which: Piece,
	geometry?: THREE.BufferGeometry
): THREE.BufferGeometry {
	const g = (geometry ?? new THREE.BoxGeometry(w, h, l)).toNonIndexed();
	g.translate(at[0], at[1], at[2]);
	const n = g.getAttribute('position').count;
	g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(1), 3));
	g.setAttribute(
		'liveryPiece',
		new THREE.Float32BufferAttribute(new Array(n).fill(piece(which)), 1)
	);
	g.deleteAttribute('uv');
	return g;
}

/** A thin bar from (x0, z0) to (x1, z1) at height y (a chevron arm): `w` wide, `h` high. */
function bar(x0: number, z0: number, x1: number, z1: number, y: number, w: number, h: number) {
	const g = new THREE.BoxGeometry(w, h, Math.hypot(x1 - x0, z1 - z0) + w);
	g.rotateY(Math.atan2(x1 - x0, z1 - z0));
	g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
	return g;
}

/**
 * One quadcopter, nose +Z, origin at the hull centre, soles of the skids DRONE_SKID_H below; every vertex
 * carries its livery piece (LIVERY_PIECES): the hull, the trim (waist band, which is the belly from below, and
 * the arms), the spine and a belly stripe, a chevron on the nose and one on the belly, the motor caps, and
 * the dark parts.
 */
export function droneGeometry(): THREE.BufferGeometry {
	const top = DRONE_BELLY; // the hull's top, and its waist band's bottom at -DRONE_BELLY
	const parts: THREE.BufferGeometry[] = [
		// a six-sided hull stretched nose to tail, a raised spine and a band round the waist
		part(
			0,
			0,
			0,
			[0, 0.02, 0],
			'hull',
			new THREE.CylinderGeometry(0.21, 0.24, 2 * DRONE_BELLY - 0.04, 6).scale(1, 1, 1.45)
		),
		part(
			0,
			0,
			0,
			[0, -DRONE_BELLY + 0.02, 0],
			'trim',
			new THREE.CylinderGeometry(0.245, 0.2, 0.04, 6).scale(1, 1, 1.45)
		),
		part(0.2, 0.07, 0.36, [0, DRONE_BELLY + 0.03, -0.04], 'spine'),
		// the marks: a stripe under the belly, a chevron on the nose and one under the belly
		part(0.09, 0.012, 0.25, [0, -top - 0.007, -0.095], 'bellyStripe'),
		part(0, 0, 0, [0, 0, 0], 'noseChevron', bar(0.11, 0.15, 0, 0.27, top + 0.006, 0.05, 0.012)),
		part(0, 0, 0, [0, 0, 0], 'noseChevron', bar(-0.11, 0.15, 0, 0.27, top + 0.006, 0.05, 0.012)),
		part(0, 0, 0, [0, 0, 0], 'bellyChevron', bar(0.11, 0.05, 0, 0.17, -top - 0.007, 0.05, 0.012)),
		part(0, 0, 0, [0, 0, 0], 'bellyChevron', bar(-0.11, 0.05, 0, 0.17, -top - 0.007, 0.05, 0.012)),
		// camera pod under the nose
		part(0.14, 0.1, 0.1, [0, -DRONE_BELLY - 0.03, 0.27], 'dark')
	];
	for (const m of MOTORS) {
		const arm = new THREE.BoxGeometry(0.07, 0.05, Math.hypot(m[0], m[2]) * 2);
		arm.rotateY(Math.atan2(m[0], m[2]));
		parts.push(part(0, 0, 0, [m[0] / 2, 0.03, m[2] / 2], 'trim', arm));
		parts.push(
			part(0, 0, 0, [m[0], m[1], m[2]], 'dark', new THREE.CylinderGeometry(0.07, 0.08, 0.12, 6))
		);
		// a coloured cap on each motor reads at a distance
		parts.push(
			part(
				0,
				0,
				0,
				[m[0], m[1] + 0.07, m[2]],
				'caps',
				new THREE.CylinderGeometry(0.05, 0.07, 0.03, 6)
			)
		);
	}
	for (const x of [-0.2, 0.2]) {
		parts.push(part(0.04, 0.04, 0.6, [x, -DRONE_SKID_H + 0.02, 0], 'dark'));
		for (const z of [-0.18, 0.18]) parts.push(part(0.03, 0.34, 0.03, [x, -0.23, z], 'dark'));
	}
	const merged = mergeGeometries(parts);
	for (const p of parts) p.dispose();
	if (!merged) throw new Error('drones: could not merge the quadcopter parts');
	return merged;
}

/**
 * A rotor's blur: a translucent disc darker at the rim, one blade ghost across it, and a guard ring round it
 * (RGBA vertex colours; the ring's white takes the instance colour, the livery's caps).
 */
export function rotorGeometry(): THREE.BufferGeometry {
	const disc = new THREE.CircleGeometry(ROTOR_R, 10).toNonIndexed();
	const blade = new THREE.PlaneGeometry(2 * ROTOR_R, 0.05).toNonIndexed();
	blade.translate(0, 0, 0.003);
	const ring = new THREE.RingGeometry(ROTOR_R - ROTOR_GUARD_W, ROTOR_R, 10, 1).toNonIndexed();
	ring.translate(0, 0, 0.006);
	const rgba = (g: THREE.BufferGeometry, f: (x: number, y: number) => number[]): void => {
		const pos = g.getAttribute('position');
		const c: number[] = [];
		for (let k = 0; k < pos.count; k++) c.push(...f(pos.getX(k), pos.getY(k)));
		g.setAttribute('color', new THREE.Float32BufferAttribute(c, 4));
		g.deleteAttribute('uv');
	};
	rgba(disc, (x, y) => (Math.hypot(x, y) < 1e-6 ? [0.2, 0.2, 0.2, 0.12] : [0.1, 0.1, 0.1, 0.4]));
	rgba(blade, () => [0.05, 0.05, 0.05, 0.75]);
	rgba(ring, () => [1, 1, 1, 0.92]);
	const merged = mergeGeometries([disc, blade, ring]);
	disc.dispose();
	blade.dispose();
	ring.dispose();
	if (!merged) throw new Error('drones: could not merge the rotor');
	merged.rotateX(-Math.PI / 2);
	return merged;
}

/** The livery texture: a row a livery, a column a piece (LIVERY_PIECES), linear RGBA floats. */
export function liveryTexture(liveries: Livery[] = DRONE_LIVERIES): THREE.DataTexture {
	const w = LIVERY_PIECES.length;
	const data = new Float32Array(w * liveries.length * 4);
	const c = new THREE.Color();
	liveries.forEach((l, row) =>
		liveryColours(l).forEach((hex, col) => {
			c.setHex(hex);
			data.set([c.r, c.g, c.b, 1], (row * w + col) * 4);
		})
	);
	const tex = new THREE.DataTexture(data, w, liveries.length, THREE.RGBAFormat, THREE.FloatType);
	tex.magFilter = tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	return tex;
}

/** The bodies' colours: each vertex's piece from the livery texture, on the instance's livery row. */
function liveryMaterial(map: THREE.DataTexture): THREE.MeshStandardMaterial {
	const m = new THREE.MeshStandardMaterial({
		vertexColors: true,
		flatShading: true,
		roughness: 0.55
	});
	m.onBeforeCompile = (shader) => {
		shader.uniforms.liveryMap = { value: map };
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				'#include <common>\nuniform sampler2D liveryMap;\nattribute float livery;\nattribute float liveryPiece;'
			)
			.replace(
				'#include <color_vertex>',
				'#include <color_vertex>\n\tvColor.rgb = color * texelFetch( liveryMap, ivec2( int( liveryPiece + 0.5 ), int( livery + 0.5 ) ), 0 ).rgb;'
			);
	};
	m.customProgramCacheKey = () => 'droneLivery';
	return m;
}

/** Parcel tape: a band TAPE_W of the box wide over the top, down two sides and under, both ways (a cross on top). */
const TAPE_W = 0.18;
/** The parcels' and lines' material: the instance colour, and the per-instance `tape` colour on the tape. */
function parcelMaterial(): THREE.MeshStandardMaterial {
	const m = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
	m.onBeforeCompile = (shader) => {
		const vary = 'varying vec3 vTape;\nvarying vec3 vBox;\nvarying vec3 vBoxN;';
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>\nattribute vec3 tape;\n${vary}`)
			.replace(
				'#include <begin_vertex>',
				'#include <begin_vertex>\n\tvTape = tape;\n\tvBox = position;\n\tvBoxN = normal;'
			);
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>\n${vary}`)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
	float tapeX = step( abs( vBox.x ), ${(TAPE_W / 2).toFixed(3)} ) * step( abs( vBoxN.x ), 0.5 );
	float tapeZ = step( abs( vBox.z ), ${(TAPE_W / 2).toFixed(3)} ) * step( abs( vBoxN.z ), 0.5 );
	diffuseColor.rgb = mix( diffuseColor.rgb, vTape, max( tapeX, tapeZ ) );`
			);
	};
	m.customProgramCacheKey = () => 'droneParcel';
	return m;
}

const _m = new THREE.Matrix4();
const _body = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _ONE = new THREE.Vector3(1, 1, 1);
const _ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _c = new THREE.Color();

/** A hidden spell of DRONE_IDLE_S from `start`: no spot, nothing drawn. */
function idleTrip(start: number): DroneTrip {
	return {
		kind: 'idle',
		start,
		end: start + DRONE_IDLE_S,
		drop: -1,
		takeoff: -1,
		livery: 0,
		ready: Infinity,
		alt: 0,
		dropYaw: 0,
		phase: 0,
		segments: []
	};
}

/**
 * DRONE_COUNT (or opts.count) drones over `spots`, cruising above `sky`, or
 * null without spots. Four InstancedMeshes: bodies (shadows when
 * opts.shadows; coloured from the livery texture by a per-instance livery
 * index), rotor discs (guards in the livery's caps colour), parcels and lines
 * (the drones' own, then DRONE_WAITING_MAX waiting on their spots; a
 * per-instance tape colour; shadows too), nav lights (shown at night only).
 * Hidden instances are scaled to nothing.
 */
export function createDrones(
	spots: DroneSpot[] | undefined,
	sky: DroneSky | undefined,
	opts: { shadows: boolean; count?: number }
): Drones | null {
	if (!spots?.length) return null;
	const n = opts.count ?? DRONE_COUNT;
	const object = new THREE.Group();
	object.name = 'Drones';

	const liveryMap = liveryTexture();
	const bodyGeometry = droneGeometry();
	const bodyLivery = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
	bodyGeometry.setAttribute('livery', bodyLivery);
	const bodies = new THREE.InstancedMesh(bodyGeometry, liveryMaterial(liveryMap), n);
	const rotors = new THREE.InstancedMesh(
		rotorGeometry(),
		new THREE.MeshStandardMaterial({
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			roughness: 1
		}),
		4 * n
	);
	// Parcel k = 2i, its line 2i + 1, then the parcels waiting on their spots from 2n: one unit box scaled
	// per instance.
	const parcelGeometry = new THREE.BoxGeometry(1, 1, 1);
	const tape = new THREE.InstancedBufferAttribute(
		new Float32Array((2 * n + DRONE_WAITING_MAX) * 3),
		3
	);
	parcelGeometry.setAttribute('tape', tape);
	const parcels = new THREE.InstancedMesh(
		parcelGeometry,
		parcelMaterial(),
		2 * n + DRONE_WAITING_MAX
	);
	const lightMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
	const lights = new THREE.InstancedMesh(
		new THREE.OctahedronGeometry(0.07, 0),
		lightMaterial,
		3 * n
	);
	bodies.name = 'DroneBodies';
	rotors.name = 'DroneRotors';
	parcels.name = 'DroneParcels';
	lights.name = 'DroneLights';
	lights.visible = false;
	for (const mesh of [bodies, rotors, parcels, lights]) {
		// The instances fly all over; their bounds would need recomputing every frame.
		mesh.frustumCulled = false;
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		object.add(mesh);
	}
	bodyLivery.setUsage(THREE.DynamicDrawUsage);
	tape.setUsage(THREE.DynamicDrawUsage);
	bodies.castShadow = parcels.castShadow = opts.shadows;
	// Every instance colour set up front, so the shaders compile with them once.
	for (let i = 0; i < n; i++) {
		for (let k = 0; k < 4; k++) rotors.setColorAt(4 * i + k, _c.setHex(DRONE_LIVERIES[0].caps));
		for (let k = 0; k < 3; k++) lights.setColorAt(3 * i + k, _c.setRGB(...LIGHTS[k].colour));
		parcels.setColorAt(2 * i + 1, _c.setHex(LINE_COLOUR));
		tape.setXYZ(2 * i + 1, _c.r, _c.g, _c.b);
	}
	for (let k = 0; k < parcels.count; k++) {
		if (k < 2 * n && k % 2) continue;
		parcels.setColorAt(k, _c.setHex(DRONE_LIVERIES[0].parcel));
		parcels.setMatrixAt(k, _ZERO);
	}

	type Flyer = { rand: () => number; trip: DroneTrip | null; livery?: number };
	const flyers: Flyer[] = Array.from({ length: n }, (_, i) => ({
		rand: mulberry32(DRONE_SEED + i),
		trip: null
	}));
	const waiting: WaitingParcel[] = [];
	let seeded = false;
	// Each spot's neighbours within DRONE_SPOT_GAP (itself included): another drone's spots keep them all busy.
	const near = spots.map((a) =>
		spots
			.map((_, k) => k)
			.filter(
				(k) => Math.hypot(spots[k].pos[0] - a.pos[0], spots[k].pos[2] - a.pos[2]) < DRONE_SPOT_GAP
			)
	);
	const others = (i: number): DroneTrip[] =>
		flyers.flatMap((f, k) => (k !== i && f.trip && f.trip.kind !== 'idle' ? [f.trip] : []));
	const busyFor = (i: number): Set<number> => {
		const busy = new Set<number>();
		for (const trip of others(i)) {
			for (const j of near[trip.drop]) busy.add(j);
			if (trip.takeoff >= 0) for (const j of near[trip.takeoff]) busy.add(j);
		}
		return busy;
	};
	// Spots no delivery may use: those holding a parcel, and the other drones' own.
	const takenFor = (i: number): Set<number> => {
		const taken = new Set(waiting.map((w) => w.spot));
		for (const trip of others(i)) {
			taken.add(trip.drop);
			if (trip.takeoff >= 0) taken.add(trip.takeoff);
		}
		return taken;
	};
	/** The parcels already lying about at the start: DRONE_WAITING_START, on spots the camera sees if it can. */
	const seedWaiting = (t: number, frame: number, eye?: Vec3): void => {
		const rand = mulberry32(DRONE_SEED - 1);
		const taken = new Set<number>();
		for (let k = 0; k < DRONE_WAITING_START; k++) {
			const spot = pickSpot(spots, frame, rand, new Set(), eye, taken);
			if (spot < 0) break;
			taken.add(spot);
			waiting.push({
				spot,
				yaw: rand() * 2 * Math.PI,
				livery: Math.floor(rand() * DRONE_LIVERIES.length),
				ready: t + rand() * DRONE_PICKUP_WAIT[1]
			});
		}
	};
	/**
	 * Drone i's next trip from `start`: a pickup of a ready parcel on a free spot the camera sees
	 * (DRONE_PICKUP_CHANCE), or of any ready one when DRONE_WAITING_MAX lie about or are on their way; else a
	 * delivery to a spot not taken; idle when there are too many parcels and none to collect, or no spot.
	 */
	const plan = (
		i: number,
		start: number,
		frame: number,
		eye?: Vec3,
		seen?: (p: Vec3) => boolean,
		lead = 0
	): DroneTrip => {
		const f = flyers[i];
		const busy = busyFor(i);
		// Hard here: a delivery idles rather than work within DRONE_SPOT_GAP of another drone.
		const taken = new Set([...takenFor(i), ...busy]);
		const coming = others(i).filter((trip) => trip.kind === 'delivery').length;
		const full = waiting.length + coming >= DRONE_WAITING_MAX;
		const ready = waiting.filter((w) => w.ready <= start && !busy.has(w.spot));
		const inView = ready.filter((w) => spotInView(spots[w.spot], frame));
		const pool = full && !inView.length ? ready : inView;
		let pickup: WaitingParcel | undefined;
		if (pool.length && (full || f.rand() < DRONE_PICKUP_CHANCE)) {
			const skip = new Set(spots.map((_, k) => k).filter((k) => !pool.some((w) => w.spot === k)));
			const spot = pickSpot(spots, frame, f.rand, skip, eye);
			pickup = waiting.splice(
				waiting.findIndex((w) => w.spot === spot),
				1
			)[0];
		} else if (full || spots.every((_, k) => taken.has(k))) {
			return idleTrip(start);
		}
		const trip = planTrip({
			spots,
			sky,
			rand: f.rand,
			start,
			frame,
			busy,
			eye,
			seen,
			lastLivery: f.livery,
			taken,
			pickup
		});
		f.livery = trip.livery;
		// The first trips start part of the way through, so the drones don't all set off together.
		const shift = lead * (trip.end - trip.start);
		return {
			...trip,
			start: trip.start - shift,
			end: trip.end - shift,
			ready: trip.ready - shift
		};
	};
	const gap = (f: Flyer): number =>
		DRONE_RESPAWN_GAP[0] + f.rand() * (DRONE_RESPAWN_GAP[1] - DRONE_RESPAWN_GAP[0]);

	const hide = (i: number): void => {
		bodies.setMatrixAt(i, _ZERO);
		for (let k = 0; k < 4; k++) rotors.setMatrixAt(4 * i + k, _ZERO);
		for (let k = 0; k < 3; k++) lights.setMatrixAt(3 * i + k, _ZERO);
		parcels.setMatrixAt(2 * i, _ZERO);
		parcels.setMatrixAt(2 * i + 1, _ZERO);
	};
	/** Parcel instance k at `at`, turned `yaw`, in livery l's parcel and tape colours. */
	const placeParcel = (k: number, at: Vec3, yaw: number, l: number): void => {
		_qYaw.setFromAxisAngle(_Y, yaw);
		parcels.setMatrixAt(
			k,
			_m.compose(_v.set(...at), _qYaw, _s.set(DRONE_PARCEL_W, DRONE_PARCEL_H, DRONE_PARCEL_W))
		);
		parcels.setColorAt(k, _c.setHex(DRONE_LIVERIES[l].parcel));
		_c.setHex(DRONE_LIVERIES[l].tape);
		tape.setXYZ(k, _c.r, _c.g, _c.b);
	};
	const onSpot = (spot: number): Vec3 => {
		const d = spots[spot].pos;
		return [d[0], d[1] + DRONE_PARCEL_H / 2, d[2]];
	};
	const poses: (DronePose | null)[] = new Array(n).fill(null);

	let last = -Infinity;
	const update = (t: number, frame: number, eye?: Vec3, seen?: (p: Vec3) => boolean): void => {
		// The clock went back: start afresh, from the seeds, so a replay is the same.
		if (t < last) {
			flyers.forEach((f, i) => {
				f.trip = null;
				f.livery = undefined;
				f.rand = mulberry32(DRONE_SEED + i);
			});
			waiting.length = 0;
			seeded = false;
		}
		last = t;
		if (!seeded) seedWaiting(t, frame, eye);
		seeded = true;
		flyers.forEach((f, i) => {
			if (!f.trip) f.trip = plan(i, t, frame, eye, seen, f.rand());
			let guard = 0;
			while (t >= f.trip.end) {
				// A delivery's parcel stays on its spot until a pickup comes for it.
				const done: DroneTrip = f.trip;
				if (done.kind === 'delivery')
					waiting.push({
						spot: done.drop,
						yaw: done.dropYaw,
						livery: done.livery,
						ready: done.ready
					});
				f.trip =
					++guard > MAX_TRIPS_PER_UPDATE
						? plan(i, t, frame, eye, seen)
						: plan(i, done.end + gap(f), frame, eye, seen);
			}
			const trip = f.trip;
			if (trip.kind === 'idle' || t < trip.start) {
				poses[i] = null;
				hide(i);
				// A pickup on its way: its parcel still lies on the spot.
				if (trip.kind === 'pickup')
					placeParcel(2 * i, onSpot(trip.drop), trip.dropYaw, trip.livery);
				return;
			}
			const pose = tripPose(trip, t, spots);
			poses[i] = pose;
			const livery = DRONE_LIVERIES[trip.livery];
			_up.set(pose.tilt[0], 1, pose.tilt[1]).normalize();
			_q.setFromUnitVectors(_Y, _up).multiply(_qYaw.setFromAxisAngle(_Y, pose.heading));
			_body.compose(_v.set(...pose.position), _q, _ONE);
			bodies.setMatrixAt(i, _body);
			bodyLivery.setX(i, trip.livery);
			const step = Math.floor(t * DRONE_ROTOR_STEPS) * DRONE_ROTOR_STEP_ANGLE;
			MOTORS.forEach((m, k) => {
				_qSpin.setFromAxisAngle(_Y, (k % 2 ? -1 : 1) * step + k);
				_local.compose(_v.set(m[0], ROTOR_Y, m[2]), _qSpin, _ONE);
				rotors.setMatrixAt(4 * i + k, _m.multiplyMatrices(_body, _local));
				rotors.setColorAt(4 * i + k, _c.setHex(livery.caps));
			});
			const strobe = (t + trip.phase) % DRONE_STROBE_PERIOD < DRONE_STROBE_ON;
			LIGHTS.forEach((l, k) => {
				if (k === 2 && !strobe) return lights.setMatrixAt(3 * i + k, _ZERO);
				_local.makeTranslation(l.at[0], l.at[1], l.at[2]);
				lights.setMatrixAt(3 * i + k, _m.multiplyMatrices(_body, _local));
			});
			// The parcel hangs plumb (and sits square on the spot when down), turned with the drone.
			const yaw = pose.dropped ? trip.dropYaw : pose.heading;
			placeParcel(2 * i, pose.parcel, yaw, trip.livery);
			if (pose.tether > 0.01) {
				const top = pose.position[1] - DRONE_BELLY;
				_v.set(pose.position[0], top - pose.tether / 2, pose.position[2]);
				_qYaw.setFromAxisAngle(_Y, pose.heading);
				parcels.setMatrixAt(2 * i + 1, _m.compose(_v, _qYaw, _s.set(LINE_W, pose.tether, LINE_W)));
			} else {
				parcels.setMatrixAt(2 * i + 1, _ZERO);
			}
		});
		for (let k = 0; k < DRONE_WAITING_MAX; k++) {
			const w = waiting[k];
			if (w) placeParcel(2 * n + k, onSpot(w.spot), w.yaw, w.livery);
			else parcels.setMatrixAt(2 * n + k, _ZERO);
		}
		for (const mesh of [bodies, rotors, parcels, lights]) mesh.instanceMatrix.needsUpdate = true;
		for (const mesh of [rotors, parcels])
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		bodyLivery.needsUpdate = tape.needsUpdate = true;
	};
	const state = (): DroneState[] =>
		flyers.map((f, i) => ({
			visible: poses[i] !== null,
			kind: f.trip?.kind ?? 'idle',
			drop: f.trip?.drop ?? -1,
			takeoff: f.trip?.takeoff ?? -1,
			livery: f.trip?.livery ?? 0,
			position: poses[i]?.position ?? [0, 0, 0],
			dropped: poses[i]?.dropped ?? false
		}));
	const setNight = (level: number): void => {
		lights.visible = level > 0;
		lightMaterial.color.setScalar(level);
	};
	const dispose = (): void => {
		for (const mesh of [bodies, rotors, parcels, lights]) {
			mesh.geometry.dispose();
			(mesh.material as THREE.Material).dispose();
			mesh.dispose();
		}
		liveryMap.dispose();
		object.clear();
	};
	return {
		object,
		update,
		state,
		waiting: () => waiting.map((w) => ({ ...w })),
		setNight,
		dispose
	};
}

function dist(a: Vec3, b: Vec3): number {
	return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
