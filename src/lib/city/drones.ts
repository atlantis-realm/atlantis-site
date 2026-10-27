// Delivery drones for the /city hero: DRONE_COUNT procedural low-poly
// quadcopters (no model: a hull, four arms with motors, skids, translucent
// rotor discs spun in steps, PSX style) making deliveries round the view. A trip
// comes in at cruise height from a point the camera doesn't see, over the
// lowest sky it can find (or takes off from a drop spot out of view), flies a
// curve on down a glide to hover over a drop spot (the export's drone_spots:
// talk-spot centres on the plaza and pavement, roof pads; straight down if no
// glide is clear), winches its parcel down onto the spot, winches the empty
// line back up, climbs and flies off out of view; after a short hidden gap it
// comes back with a new trip. Drop spots the camera sees at the current frame
// are preferred, the near ones more (spotWeight), and so are glides it sees,
// so deliveries happen in the frame. Cruise height clears the export's sky
// grid (drone_sky: the top of the scene) by DRONE_SKY_CLEAR along both legs,
// the glide by DRONE_GLIDE_CLEAR. The drone leans with its
// acceleration (speeding up, braking, turning) and wobbles a little. Picks are
// seeded per drone (mulberry32), and every pose is a function of the scene
// clock (frozen with reduced motion). All drones share four InstancedMeshes
// (bodies, rotors, parcels and lines, nav lights): 5 draw calls by day with
// shadows, 6 at night (the red / green / white strobe lights, which bloom).

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
/** Hull colours (one per trip) and parcel colours. */
export const DRONE_COLOURS = [0xe8e4dc, 0xd9a441, 0x3f7fbf, 0xc4553d, 0x4f9a6a, 0x6b6f78];
const PARCEL_COLOURS = [0xb98a55, 0xa77b4a, 0xd8d2c4, 0x5d7fa3];
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

/** One delivery: its segments, timed from `start` (s, scene clock) to `end`. */
export type DroneTrip = {
	start: number;
	end: number;
	/** Index of the drop spot, and of the take-off spot (-1: flew in). */
	drop: number;
	takeoff: number;
	colour: number;
	parcelColour: number;
	/** Cruise height (m, absolute). */
	alt: number;
	/** The parcel's heading once on the ground (the drone's on arrival). */
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
	/** The parcel's centre: on the line, or on the drop spot once dropped. */
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
	/** Colour index to avoid (the drone's last). */
	lastColour?: number;
};

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
 * A random drop spot index: among the spots not `busy` (all if every one is),
 * the ones in view at `frame` if any; weighted by spotWeight from `eye` when
 * given, else evenly.
 */
export function pickSpot(
	spots: DroneSpot[],
	frame: number,
	rand: () => number,
	busy: Set<number>,
	eye?: Vec3
): number {
	let free = spots.map((_, k) => k).filter((k) => !busy.has(k));
	if (!free.length) free = spots.map((_, k) => k);
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

/**
 * A delivery setting off at `start`: a drop spot (pickSpot), then either a
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
	const drop = pickSpot(spots, plan.frame, rand, busy, plan.eye);
	const d = spots[drop].pos;
	const roof = spots[drop].kind === 'roof';
	const agl = range(roof ? DRONE_ROOF_AGL : DRONE_CRUISE_AGL);
	const speed = range(DRONE_SPEED);
	let colour = Math.floor(rand() * DRONE_COLOURS.length);
	if (colour === plan.lastColour) colour = (colour + 1) % DRONE_COLOURS.length;
	const parcelColour = Math.floor(rand() * PARCEL_COLOURS.length);

	let takeoff = -1;
	if (rand() < DRONE_TAKEOFF_CHANCE) {
		const pool = spots
			.map((_, k) => k)
			.filter(
				(k) =>
					k !== drop &&
					!busy.has(k) &&
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
	if (takeoff >= 0) {
		const ground: Vec3 = [from[0], from[1] + DRONE_SKID_H, from[2]];
		add([ground], { dur: DRONE_SPINUP_S, yaw0: yawIn, tether0: 0, wobble: false });
		add([ground, inbound[0]], {
			speed: DRONE_CLIMB_SPEED,
			accel: DRONE_VERTICAL_ACCEL,
			yaw0: yawIn,
			tether0: 0,
			tether1: DRONE_TETHER
		});
	}
	add(inbound, { speed, accel: DRONE_ACCEL, follow: true });
	if (!glide) {
		const top = inbound[inbound.length - 1];
		add([top], { dur: DRONE_STOP_S, yaw0: yawArrive });
		add([top, hover], { speed: DRONE_DESCENT_SPEED, accel: DRONE_VERTICAL_ACCEL, yaw0: yawArrive });
	}
	add([hover], { dur: DRONE_SETTLE_S, yaw0: yawArrive });
	const winch = (low - DRONE_TETHER) / DRONE_WINCH_SPEED;
	add([hover], { dur: winch, yaw0: yawArrive, tether0: DRONE_TETHER, tether1: low });
	add([hover], { dur: DRONE_RELEASE_S, yaw0: yawArrive, tether0: low, dropped: true });
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

	return {
		start: plan.start,
		end: plan.start + t,
		drop,
		takeoff,
		colour,
		parcelColour,
		alt,
		dropYaw: yawArrive,
		phase: rand() * 2 * Math.PI,
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
	drop: number;
	takeoff: number;
	position: Vec3;
	dropped: boolean;
};

/**
 * update(t, frame, eye, seen) flies every drone to time t (s), planning new
 * trips at camera frame `frame` (drop spots in view, the near ones from the
 * camera's world position `eye` more) with entry and exit points `seen(p)`
 * says the camera doesn't see.
 */
export type Drones = {
	object: THREE.Group;
	update(t: number, frame: number, eye?: Vec3, seen?: (p: Vec3) => boolean): void;
	state(): DroneState[];
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

/** A box part with a flat vertex colour (multiplied by the instance colour). */
function part(
	w: number,
	h: number,
	l: number,
	at: Vec3,
	shade: number,
	geometry?: THREE.BufferGeometry
): THREE.BufferGeometry {
	const g = (geometry ?? new THREE.BoxGeometry(w, h, l)).toNonIndexed();
	g.translate(at[0], at[1], at[2]);
	const n = g.getAttribute('position').count;
	g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(shade), 3));
	g.deleteAttribute('uv');
	return g;
}

/** One quadcopter, nose +Z, origin at the hull centre, soles of the skids DRONE_SKID_H below. */
export function droneGeometry(): THREE.BufferGeometry {
	const dark = 0.12;
	const parts: THREE.BufferGeometry[] = [
		// a six-sided hull stretched nose to tail, a raised spine and a dark band round the waist
		part(
			0,
			0,
			0,
			[0, 0.02, 0],
			1,
			new THREE.CylinderGeometry(0.21, 0.24, 2 * DRONE_BELLY - 0.04, 6).scale(1, 1, 1.45)
		),
		part(
			0,
			0,
			0,
			[0, -DRONE_BELLY + 0.02, 0],
			dark,
			new THREE.CylinderGeometry(0.245, 0.2, 0.04, 6).scale(1, 1, 1.45)
		),
		part(0.2, 0.07, 0.36, [0, DRONE_BELLY + 0.03, -0.04], 1),
		// camera pod under the nose
		part(0.14, 0.1, 0.1, [0, -DRONE_BELLY - 0.03, 0.27], dark)
	];
	for (const m of MOTORS) {
		const arm = new THREE.BoxGeometry(0.07, 0.05, Math.hypot(m[0], m[2]) * 2);
		arm.rotateY(Math.atan2(m[0], m[2]));
		parts.push(part(0, 0, 0, [m[0] / 2, 0.03, m[2] / 2], dark, arm));
		parts.push(
			part(0, 0, 0, [m[0], m[1], m[2]], dark, new THREE.CylinderGeometry(0.07, 0.08, 0.12, 6))
		);
		// a coloured cap on each motor reads at a distance
		parts.push(
			part(0, 0, 0, [m[0], m[1] + 0.07, m[2]], 1, new THREE.CylinderGeometry(0.05, 0.07, 0.03, 6))
		);
	}
	for (const x of [-0.2, 0.2]) {
		parts.push(part(0.04, 0.04, 0.6, [x, -DRONE_SKID_H + 0.02, 0], dark));
		for (const z of [-0.18, 0.18]) parts.push(part(0.03, 0.34, 0.03, [x, -0.23, z], dark));
	}
	const merged = mergeGeometries(parts);
	for (const p of parts) p.dispose();
	if (!merged) throw new Error('drones: could not merge the quadcopter parts');
	return merged;
}

/** A rotor's blur: a translucent disc darker at the rim, and one blade ghost across it (RGBA vertex colours). */
export function rotorGeometry(): THREE.BufferGeometry {
	const disc = new THREE.CircleGeometry(ROTOR_R, 10).toNonIndexed();
	const blade = new THREE.PlaneGeometry(2 * ROTOR_R, 0.05).toNonIndexed();
	blade.translate(0, 0, 0.003);
	const rgba = (g: THREE.BufferGeometry, f: (x: number, y: number) => number[]): void => {
		const pos = g.getAttribute('position');
		const c: number[] = [];
		for (let k = 0; k < pos.count; k++) c.push(...f(pos.getX(k), pos.getY(k)));
		g.setAttribute('color', new THREE.Float32BufferAttribute(c, 4));
		g.deleteAttribute('uv');
	};
	rgba(disc, (x, y) => (Math.hypot(x, y) < 1e-6 ? [0.2, 0.2, 0.2, 0.12] : [0.1, 0.1, 0.1, 0.4]));
	rgba(blade, () => [0.05, 0.05, 0.05, 0.75]);
	const merged = mergeGeometries([disc, blade]);
	disc.dispose();
	blade.dispose();
	if (!merged) throw new Error('drones: could not merge the rotor');
	merged.rotateX(-Math.PI / 2);
	return merged;
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

/**
 * DRONE_COUNT (or opts.count) drones over `spots`, cruising above `sky`, or
 * null without spots. Four InstancedMeshes: bodies (shadows when
 * opts.shadows), rotor discs, parcels and lines (shadows too), nav lights
 * (shown at night only). Hidden instances are scaled to nothing.
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

	const bodies = new THREE.InstancedMesh(
		droneGeometry(),
		new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55 }),
		n
	);
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
	// Parcel k = 2i, its line 2i + 1: one unit box scaled per instance.
	const parcels = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
		2 * n
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
	bodies.castShadow = parcels.castShadow = opts.shadows;
	for (let i = 0; i < n; i++) {
		// Every instance colour set up front, so the shaders compile with them once.
		bodies.setColorAt(i, _c.setHex(DRONE_COLOURS[0]));
		parcels.setColorAt(2 * i, _c.setHex(PARCEL_COLOURS[0]));
		for (let k = 0; k < 3; k++) lights.setColorAt(3 * i + k, _c.setRGB(...LIGHTS[k].colour));
		parcels.setColorAt(2 * i + 1, _c.setHex(LINE_COLOUR));
	}

	type Flyer = { rand: () => number; trip: DroneTrip | null };
	const flyers: Flyer[] = Array.from({ length: n }, (_, i) => ({
		rand: mulberry32(DRONE_SEED + i),
		trip: null
	}));
	// Each spot's neighbours within DRONE_SPOT_GAP (itself included): another drone's spots keep them all busy.
	const near = spots.map((a) =>
		spots
			.map((_, k) => k)
			.filter(
				(k) => Math.hypot(spots[k].pos[0] - a.pos[0], spots[k].pos[2] - a.pos[2]) < DRONE_SPOT_GAP
			)
	);
	const busyFor = (i: number): Set<number> => {
		const busy = new Set<number>();
		flyers.forEach((f, k) => {
			if (k === i || !f.trip) return;
			for (const j of near[f.trip.drop]) busy.add(j);
			if (f.trip.takeoff >= 0) for (const j of near[f.trip.takeoff]) busy.add(j);
		});
		return busy;
	};
	const plan = (
		i: number,
		start: number,
		frame: number,
		eye?: Vec3,
		seen?: (p: Vec3) => boolean,
		lead = 0
	): DroneTrip => {
		const f = flyers[i];
		const trip = planTrip({
			spots,
			sky,
			rand: f.rand,
			start,
			frame,
			busy: busyFor(i),
			eye,
			seen,
			lastColour: f.trip?.colour
		});
		// The first trips start part of the way through, so the drones don't all set off together.
		const shift = lead * (trip.end - trip.start);
		return { ...trip, start: trip.start - shift, end: trip.end - shift };
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
	const poses: (DronePose | null)[] = new Array(n).fill(null);

	let last = -Infinity;
	const update = (t: number, frame: number, eye?: Vec3, seen?: (p: Vec3) => boolean): void => {
		// The clock went back: start afresh, from the seeds, so a replay is the same.
		if (t < last)
			flyers.forEach((f, i) => {
				f.trip = null;
				f.rand = mulberry32(DRONE_SEED + i);
			});
		last = t;
		flyers.forEach((f, i) => {
			if (!f.trip) f.trip = plan(i, t, frame, eye, seen, f.rand());
			let guard = 0;
			while (t >= f.trip.end) {
				f.trip =
					++guard > MAX_TRIPS_PER_UPDATE
						? plan(i, t, frame, eye, seen)
						: plan(i, f.trip.end + gap(f), frame, eye, seen);
			}
			const trip = f.trip;
			if (t < trip.start) {
				poses[i] = null;
				hide(i);
				return;
			}
			const pose = tripPose(trip, t, spots);
			poses[i] = pose;
			_up.set(pose.tilt[0], 1, pose.tilt[1]).normalize();
			_q.setFromUnitVectors(_Y, _up).multiply(_qYaw.setFromAxisAngle(_Y, pose.heading));
			_body.compose(_v.set(...pose.position), _q, _ONE);
			bodies.setMatrixAt(i, _body);
			bodies.setColorAt(i, _c.setHex(DRONE_COLOURS[trip.colour]));
			const step = Math.floor(t * DRONE_ROTOR_STEPS) * DRONE_ROTOR_STEP_ANGLE;
			MOTORS.forEach((m, k) => {
				_qSpin.setFromAxisAngle(_Y, (k % 2 ? -1 : 1) * step + k);
				_local.compose(_v.set(m[0], ROTOR_Y, m[2]), _qSpin, _ONE);
				rotors.setMatrixAt(4 * i + k, _m.multiplyMatrices(_body, _local));
			});
			const strobe = (t + trip.phase) % DRONE_STROBE_PERIOD < DRONE_STROBE_ON;
			LIGHTS.forEach((l, k) => {
				if (k === 2 && !strobe) return lights.setMatrixAt(3 * i + k, _ZERO);
				_local.makeTranslation(l.at[0], l.at[1], l.at[2]);
				lights.setMatrixAt(3 * i + k, _m.multiplyMatrices(_body, _local));
			});
			// The parcel hangs plumb (and sits square on the spot once dropped), turned with the drone.
			const yaw = pose.dropped ? trip.dropYaw : pose.heading;
			_qYaw.setFromAxisAngle(_Y, yaw);
			parcels.setMatrixAt(
				2 * i,
				_m.compose(
					_v.set(...pose.parcel),
					_qYaw,
					_s.set(DRONE_PARCEL_W, DRONE_PARCEL_H, DRONE_PARCEL_W)
				)
			);
			parcels.setColorAt(2 * i, _c.setHex(PARCEL_COLOURS[trip.parcelColour]));
			if (pose.tether > 0.01) {
				const top = pose.position[1] - DRONE_BELLY;
				_v.set(pose.position[0], top - pose.tether / 2, pose.position[2]);
				parcels.setMatrixAt(2 * i + 1, _m.compose(_v, _qYaw, _s.set(LINE_W, pose.tether, LINE_W)));
			} else {
				parcels.setMatrixAt(2 * i + 1, _ZERO);
			}
		});
		for (const mesh of [bodies, rotors, parcels, lights]) mesh.instanceMatrix.needsUpdate = true;
		for (const mesh of [bodies, parcels])
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	};
	const state = (): DroneState[] =>
		flyers.map((f, i) => ({
			visible: poses[i] !== null,
			drop: f.trip?.drop ?? -1,
			takeoff: f.trip?.takeoff ?? -1,
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
		object.clear();
	};
	return { object, update, state, setNight, dispose };
}

function dist(a: Vec3, b: Vec3): number {
	return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
