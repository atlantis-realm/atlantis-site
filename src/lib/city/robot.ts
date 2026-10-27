// The robots for the /city hero: ROBOT_COUNT mechs from robot.glb (export_robot.py,
// robot_glb.mjs: VARIANTS skinned meshes on one rig with a 'walk' clip, and a
// strip of palettes) walking across the view on the export's robot routes
// (hero_props.json `robot_routes`: the ring avenue and cross streets that cross
// the hero avenue, hidden at both ends). Each pass a robot picks a free route,
// one the camera sees at the current frame if it can, the near ones far more
// often (routeWeight: the far crossings are specks), walks it end to end, screen
// left to right or back (two may share a route, ROBOT_FOLLOW_GAP apart, one
// waiting hidden a little if need be), then is hidden for a moment
// (ROBOT_RESPAWN_GAP) and comes back as a freshly rolled robot: another variant
// mesh and palette. The picks are seeded per robot (mulberry32), so a given
// scroll history replays the same. Unlike the people's stepped morph walk, its
// walk is played smoothly: the clip time follows the distance walked at the
// variant's stride, so its feet don't skate. At night its palette glows faintly
// (ROBOT_NIGHT_GLOW), so it doesn't sink into the dark trees behind it.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mulberry32, walkerPose, type WalkerPose } from './people.ts';
import type { RobotRoute, Vec3 } from './props.ts';

/** Robots walking at once, each on its own route (1 for a single robot). */
export const ROBOT_COUNT = 2;
/** Robot i draws its picks from mulberry32(ROBOT_SEED + i). */
export const ROBOT_SEED = 0x60b07;
/** A route is in view when one of its `view` sample frames is within this many frames (the export samples every 5). */
export const ROUTE_VIEW_SLACK = 5;
/** Route weight falls off as the distance (m) from the camera to its nearest point to this power (2: screen area). */
export const ROUTE_NEAR_POWER = 2;
/** Distances (m) below this weigh as this (the camera never stands on a route). */
export const ROUTE_NEAR_MIN = 10;
/** Two robots may share a route walking the same way at least this far (m) apart all along. */
export const ROBOT_FOLLOW_GAP = 12;
/**
 * A robot may wait hidden up to this long (s) for a route another robot is on
 * to clear (ROBOT_FOLLOW_GAP behind it, or off it before a head-on), tried in
 * steps of ROBOT_FOLLOW_WAIT_STEP; past that the route counts as busy.
 */
export const ROBOT_FOLLOW_WAIT = 12;
export const ROBOT_FOLLOW_WAIT_STEP = 0.5;
/** Hidden pause (s) between a robot leaving a route and the next robot coming in: [min, max]. */
export const ROBOT_RESPAWN_GAP: [number, number] = [0.5, 3];
/** The heading is the chord from this far (m) behind to this far ahead, so it turns smoothly round the ring arcs. */
export const ROBOT_TURN_LOOK = 1.5;
/** Emissive strength of the palette (its own colours) at full night, scaled by mixMode's emissive level. */
export const ROBOT_NIGHT_GLOW = 0.15;
/** Name of the robots' walk clip in robot.glb. */
export const ROBOT_WALK_CLIP = 'walk';
/** Passes planned in one update before giving up and starting afresh (a long-hidden tab). */
const MAX_PASSES_PER_UPDATE = 100;

/** One baked variant: its mesh node in robot.glb and its measures. */
export type RobotVariant = {
	name: string;
	/** Bind pose height (m). */
	height: number;
	/** Ground distance covered per loop of the walk clip (m). */
	walk_cycle_m: number;
	tris?: number;
};

/** robot_meta.json (version 2), written by export_robot.py beside robot.glb. */
export type RobotMeta = {
	version: number;
	/** Variant 0's height and walk_cycle_m. */
	height: number;
	walk_cycle_m: number;
	walk_duration_s: number;
	idle_duration_s?: number;
	/** The palette strip's palettes, left to right (the variants' UVs sit in the first). */
	palettes: string[];
	variants: RobotVariant[];
};

/** What robot.glb + robot_meta.json load to. */
export type RobotAsset = {
	scene: THREE.Object3D;
	animations: THREE.AnimationClip[];
	meta: RobotMeta;
};

/** One robot's current pass, for tests and debugging; `distance` (m) along its route, which runs reversed or not. */
export type RobotState = {
	visible: boolean;
	route: string;
	reversed: boolean;
	variant: number;
	palette: number;
	distance: number;
};

/**
 * update(t, frame, eye) walks every robot to time t (s), picking new routes in
 * view at camera frame `frame`, weighted by nearness to `eye` (the camera's
 * world position; without it every route weighs the same).
 */
export type Robots = {
	object: THREE.Group;
	update(t: number, frame: number, eye?: Vec3): void;
	state(): RobotState[];
	setNight(level: number): void;
	dispose(): void;
};

/** Check robot_meta.json's shape (a stale version 1 or wrong file fails loudly). */
export function parseRobotMeta(json: unknown): RobotMeta {
	const m = json as RobotMeta;
	const ok =
		!!m &&
		m.height > 0 &&
		m.walk_cycle_m > 0 &&
		m.walk_duration_s > 0 &&
		Array.isArray(m.palettes) &&
		m.palettes.length > 0 &&
		m.palettes.every((p) => typeof p === 'string') &&
		Array.isArray(m.variants) &&
		m.variants.length > 0 &&
		m.variants.every((v) => typeof v?.name === 'string' && v.height > 0 && v.walk_cycle_m > 0);
	if (!ok)
		throw new Error(
			'robot_meta.json: needs height, walk_cycle_m, walk_duration_s, palettes and variants (version 2)'
		);
	return m;
}

/** Walk clip time (s, in [0, duration)) after `distance` m walked: one clip loop per `cycle_m`. */
export function robotWalkTime(distance: number, cycle_m: number, duration: number): number {
	const phase = (((distance / cycle_m) % 1) + 1) % 1;
	return phase * duration;
}

/** Whether camera frame `frame` sees some of `route`: a `view` sample within ROUTE_VIEW_SLACK frames. */
export function routeInView(route: RobotRoute, frame: number): boolean {
	return route.view.some(([f]) => Math.abs(f - frame) <= ROUTE_VIEW_SLACK);
}

/**
 * How strongly to prefer `route` seen from `eye`: 1 / d^ROUTE_NEAR_POWER, d the
 * distance to its nearest point (at least ROUTE_NEAR_MIN), so a crossing 70 m
 * out beats one 380 m out about 30 to 1, as its robot covers ~30x the screen.
 */
export function routeWeight(route: RobotRoute, eye: Vec3): number {
	const d = Math.min(...route.points.map((p) => dist(p, eye)));
	return Math.max(d, ROUTE_NEAR_MIN) ** -ROUTE_NEAR_POWER;
}

/**
 * A random route index: among the routes not `busy` (all of them if every one
 * is), the ones in view at `frame` if any; weighted by routeWeight from `eye`
 * when given, else evenly.
 */
export function pickRoute(
	routes: RobotRoute[],
	frame: number,
	rand: () => number,
	busy: Set<number>,
	eye?: Vec3
): number {
	let free = routes.map((_, k) => k).filter((k) => !busy.has(k));
	if (!free.length) free = routes.map((_, k) => k);
	const seen = free.filter((k) => routeInView(routes[k], frame));
	const pool = seen.length ? seen : free;
	const weights = pool.map((k) => (eye ? routeWeight(routes[k], eye) : 1));
	let r = rand() * weights.reduce((a, b) => a + b, 0);
	for (let k = 0; k < pool.length; k++) if ((r -= weights[k]) < 0) return pool[k];
	return pool[pool.length - 1];
}

/** A pass's timing on its route: set off at `start` (s) at `speed` (m/s), `length` m, reversed or not. */
export type PassSlot = { start: number; speed: number; length: number; reversed: boolean };

/**
 * Whether two passes of the same route stay at least `gap` m apart while both
 * are on it (either way round, so a head-on pair fails unless one is off before
 * the other is on). Their separation is linear in time, so its two ends decide.
 */
export function passesApart(a: PassSlot, b: PassSlot, gap: number): boolean {
	const end = (p: PassSlot): number => p.start + p.length / p.speed;
	const at = (p: PassSlot, t: number): number => {
		const s = (t - p.start) * p.speed;
		return p.reversed ? p.length - s : s;
	};
	const lo = Math.max(a.start, b.start);
	const hi = Math.min(end(a), end(b));
	if (lo > hi) return true;
	const d0 = at(a, lo) - at(b, lo);
	const d1 = at(a, hi) - at(b, hi);
	return Math.sign(d0) === Math.sign(d1) && Math.min(Math.abs(d0), Math.abs(d1)) >= gap;
}

/** A random index in [0, n), not one of `avoid` unless that leaves none. */
export function pickIndex(n: number, rand: () => number, avoid: number[]): number {
	let pool = Array.from({ length: n }, (_, k) => k).filter((k) => !avoid.includes(k));
	if (!pool.length) pool = Array.from({ length: n }, (_, k) => k);
	return pool[Math.floor(rand() * pool.length)];
}

/**
 * The robot at distance `s` (m) along the open polyline `points`, clamped to
 * its ends: walkerPose's position (its height interpolated between points, so
 * it rides kerbs), and the heading of the chord from ROBOT_TURN_LOOK behind to
 * ROBOT_TURN_LOOK ahead (clamped too), so it turns smoothly round the arcs.
 */
export function routePose(points: Vec3[], s: number): WalkerPose {
	let length = 0;
	for (let k = 1; k < points.length; k++) length += dist(points[k - 1], points[k]);
	const at = (d: number): Vec3 => walkerPose(points, Math.min(Math.max(d, 0), length)).position;
	const position = at(s);
	const a = at(s - ROBOT_TURN_LOOK);
	const b = at(s + ROBOT_TURN_LOOK);
	return { position, heading: Math.atan2(b[0] - a[0], b[2] - a[2]) };
}

/** robot.glb + robot_meta.json, or null (with one warning) when either fails. */
export async function loadRobotAsset(
	loader: {
		loadAsync(url: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>;
	},
	glbUrl: string,
	metaUrl: string,
	fetchFn: (url: string) => Promise<Response> = fetch
): Promise<RobotAsset | null> {
	try {
		const [meta, gltf] = await Promise.all([
			fetchFn(metaUrl).then((res) => {
				if (!res.ok) throw new Error(`${metaUrl}: HTTP ${res.status}`);
				return res.json().then(parseRobotMeta);
			}),
			loader.loadAsync(glbUrl)
		]);
		return { scene: gltf.scene, animations: gltf.animations, meta };
	} catch (err) {
		console.warn('City hero: no robot.', err);
		return null;
	}
}

/** A route walked one way: its points in walking order and length; `start` (s) it sets off from the first point. */
type Pass = PassSlot & {
	route: number;
	points: Vec3[];
	variant: number;
	palette: number;
	/** Time (s) it reaches the last point. */
	end: number;
};

/** One robot: its own clone of the rig and variant meshes, material (palette offset), mixer and picks. */
type Walker = {
	holder: THREE.Group;
	meshes: THREE.Object3D[];
	material: THREE.MeshStandardMaterial;
	mixer: THREE.AnimationMixer;
	action: THREE.AnimationAction;
	rand: () => number;
	pass: Pass | null;
};

/**
 * ROBOT_COUNT robots from robot.glb's `scene` and `animations`, crossing on
 * `routes`, or null without a walk clip, a route or any of the meta's variant
 * meshes. Each robot is a skeleton clone of the scene showing one variant mesh
 * at a time; its walk clip is paused and time-driven: update(t) sets the clip
 * time from the distance walked, so it is as smooth as the frames and freezes
 * with t.
 */
export function createRobots(
	scene: THREE.Object3D,
	animations: THREE.AnimationClip[],
	meta: RobotMeta,
	routes: RobotRoute[] | undefined,
	opts: { shadows: boolean; count?: number }
): Robots | null {
	const clip = THREE.AnimationClip.findByName(animations, ROBOT_WALK_CLIP);
	const variants = meta.variants.filter((v) => scene.getObjectByName(v.name));
	if (!clip || !routes?.length || !variants.length) return null;
	const palettes = meta.palettes.length;

	const object = new THREE.Group();
	object.name = 'Robots';
	const walkers: Walker[] = [];
	for (let i = 0; i < (opts.count ?? ROBOT_COUNT); i++) {
		const root = cloneSkinned(scene);
		const meshes = variants.map((v) => root.getObjectByName(v.name)!);
		// One material per robot, so each has its own palette offset; the map shares the image.
		const source = (meshes[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
		const material = source.clone();
		if (source.map) {
			material.map = source.map.clone();
			material.map.magFilter = material.map.minFilter = THREE.NearestFilter;
			material.map.generateMipmaps = false;
		}
		// The palette as its own glow, off by day: set up once, so night only changes the strength.
		material.emissiveMap = material.map;
		material.emissive.setRGB(1, 1, 1);
		material.emissiveIntensity = 0;
		root.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (!mesh.isMesh) return;
			mesh.material = material;
			mesh.castShadow = mesh.receiveShadow = opts.shadows;
			mesh.visible = false;
		});
		const holder = new THREE.Group();
		holder.name = `Robot${i}`;
		holder.visible = false;
		holder.add(root);
		object.add(holder);
		const mixer = new THREE.AnimationMixer(root);
		const action = mixer.clipAction(clip);
		action.play();
		action.paused = true;
		walkers.push({
			holder,
			meshes,
			material,
			mixer,
			action,
			rand: mulberry32(ROBOT_SEED + i),
			pass: null
		});
	}

	const lengths = routes.map((r) => {
		let length = 0;
		for (let k = 1; k < r.points.length; k++) length += dist(r.points[k - 1], r.points[k]);
		return length;
	});
	/**
	 * Robot i's next pass, setting off at `start` (the first: `lead` of the way
	 * along already) in a random direction. A route another robot is on is free
	 * if, setting off then or after a hidden wait of up to ROBOT_FOLLOW_WAIT, it
	 * keeps ROBOT_FOLLOW_GAP from it all along (passesApart).
	 */
	const plan = (i: number, start: number, frame: number, eye?: Vec3, lead = 0): Pass => {
		const w = walkers[i];
		const others = walkers.filter((x, k) => k !== i && x.pass).map((x) => x.pass!);
		const variant = pickIndex(variants.length, w.rand, [
			...(w.pass ? [w.pass.variant] : []),
			...others.map((p) => p.variant)
		]);
		const palette = pickIndex(palettes, w.rand, [
			...(w.pass ? [w.pass.palette] : []),
			...others.map((p) => p.palette)
		]);
		const speed = variants[variant].walk_cycle_m / meta.walk_duration_s;
		const reversed = w.rand() < 0.5;
		const slot = (k: number, wait: number): PassSlot => ({
			start: start + wait - (lead * lengths[k]) / speed,
			speed,
			length: lengths[k],
			reversed
		});
		const clear = (k: number, wait: number): boolean =>
			others.every((o) => o.route !== k || passesApart(o, slot(k, wait), ROBOT_FOLLOW_GAP));
		// Per route, the shortest hidden wait that keeps clear of the robots on it (-1: none within ROBOT_FOLLOW_WAIT).
		const waits = routes.map((_, k) => {
			for (let wait = 0; wait <= ROBOT_FOLLOW_WAIT; wait += ROBOT_FOLLOW_WAIT_STEP)
				if (clear(k, wait)) return wait;
			return -1;
		});
		const busy = new Set(routes.map((_, k) => k).filter((k) => waits[k] < 0));
		const route = pickRoute(routes, frame, w.rand, busy, eye);
		const points = reversed ? [...routes[route].points].reverse() : routes[route].points;
		const length = lengths[route];
		const begin = slot(route, Math.max(waits[route], 0)).start;
		return {
			route,
			reversed,
			points,
			length,
			variant,
			palette,
			speed,
			start: begin,
			end: begin + length / speed
		};
	};
	const gap = (w: Walker): number =>
		ROBOT_RESPAWN_GAP[0] + w.rand() * (ROBOT_RESPAWN_GAP[1] - ROBOT_RESPAWN_GAP[0]);

	let last = -Infinity;
	const update = (t: number, frame: number, eye?: Vec3): void => {
		if (t < last) for (const w of walkers) w.pass = null; // the clock went back: start afresh
		last = t;
		walkers.forEach((w, i) => {
			// The first pass starts part of the way along, so the robots don't all set off together.
			if (!w.pass) w.pass = plan(i, t, frame, eye, w.rand());
			let n = 0;
			while (t >= w.pass.end) {
				w.pass =
					++n > MAX_PASSES_PER_UPDATE
						? plan(i, t, frame, eye)
						: plan(i, w.pass.end + gap(w), frame, eye);
			}
			const p = w.pass;
			const shown = t >= p.start;
			w.holder.visible = shown;
			if (!shown) return;
			w.meshes.forEach((m, k) => (m.visible = k === p.variant));
			if (w.material.map) w.material.map.offset.x = p.palette / palettes;
			const s = (t - p.start) * p.speed;
			const { position, heading } = routePose(p.points, s);
			w.holder.position.set(...position);
			w.holder.rotation.y = heading;
			w.action.time = robotWalkTime(s, variants[p.variant].walk_cycle_m, clip.duration);
			w.mixer.update(0);
		});
	};
	const state = (): RobotState[] =>
		walkers.map((w) => {
			const p = w.pass;
			return {
				visible: w.holder.visible,
				route: p ? routes[p.route].name : '',
				reversed: p?.reversed ?? false,
				variant: p?.variant ?? 0,
				palette: p?.palette ?? 0,
				distance: p ? Math.max(0, (last - p.start) * p.speed) : 0
			};
		});
	const setNight = (level: number): void => {
		for (const w of walkers) w.material.emissiveIntensity = ROBOT_NIGHT_GLOW * level;
	};
	const dispose = (): void => {
		for (const w of walkers) {
			w.mixer.stopAllAction();
			w.mixer.uncacheRoot(w.mixer.getRoot());
			w.holder.traverse((obj) => {
				const mesh = obj as THREE.SkinnedMesh;
				if (mesh.isSkinnedMesh) mesh.skeleton.dispose();
			});
			// emissiveMap is the same texture.
			w.material.map?.dispose();
			w.material.dispose();
		}
		// The clones share the scene's geometry.
		scene.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (!mesh.isMesh) return;
			mesh.geometry.dispose();
			for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
				(m as THREE.MeshStandardMaterial).map?.dispose();
				m.dispose();
			}
		});
		object.clear();
	};
	return { object, update, state, setNight, dispose };
}

function dist(a: Vec3, b: Vec3): number {
	return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
