// hero_props.json: the scene facts the export writes next to hero.glb
// (concept-assets/city/generators/export_hero.py, "Props" step). All positions
// are in glTF space (Y up), i.e. (x, z, -y) from Blender.

export type Vec3 = [number, number, number];

/** Where an idle person can sit (on a ledge edge, over a drop) or lean (back to a wall). */
export type IdleSpot = {
	pose: 'sit' | 'lean';
	/** sit: a point on the ledge-top edge; lean: a point on the ground at the wall's foot. */
	pos: Vec3;
	/** Yaw about +Y turning local +Z to the facing (as walkerPose): out over the drop, or away from the wall. */
	heading: number;
	/** sit only: ledge top minus the ground in front, in metres. */
	drop?: number;
	/** lean only (version 2): the wall or railing top above the ground, in metres; null for a wall taller than
	 * the export scans (1.8 m). A forward lean (forearms on the top) suits about 0.95-1.25 m. */
	top?: number | null;
	/** Which part of the scene: 'well' (within WELL_AREA_R of the well: the walkway round it), 'avenue' or 'other'. */
	area?: string;
};

/** A line the robot can walk across the hero view, on a ring avenue or cross street (version 2). */
export type RobotRoute = {
	/** e.g. 'street_57', 'ring_belt_1_in' (inner half of that ring avenue's road). */
	name: string;
	/** 'ring' (along a ring avenue's arc) or 'street' (a straight cross street). */
	kind: string;
	/** Metres from the well centre along the hero avenue where the route crosses its axis. */
	along: number;
	/** Ground points ROUTE_STEP (2 m) apart, screen left to right as the hero camera sees them. */
	points: Vec3[];
	/** Length in metres (horizontal, along the points). */
	len: number;
	/** [from, to] metres along the route seen from some sample frame; the route runs on unseen past both. */
	seen: [number, number];
	/** [frame, from, to] per Blender sample frame (every 5) that sees part of it, 16:9 view. */
	view: [number, number, number][];
};

/** Open flat ground for a conversation circle (version 2): free and level within `radius` of `pos`. */
export type TalkSpot = {
	/** The circle's centre on the ground (y = ground height). */
	pos: Vec3;
	/** Metres of free flat ground round the centre. */
	radius: number;
	/** 'well', 'avenue' or 'other', as IdleSpot.area. */
	area?: string;
};

/** Where a delivery drone can drop a parcel (or take off from): open ground or a roof pad with free sky above. */
export type DroneSpot = {
	/** The drop point on the ground or roof. */
	pos: Vec3;
	/** 'ground' (a talk spot's centre: plaza or pavement) or 'roof'. */
	kind: string;
	/** Blender sample frames (every 5) whose 16:9 view sees a drone hovering DRONE_VIEW_H (3 m) above it. */
	frames: number[];
};

/**
 * The top of the scene over the drones' flying area: `nx` x `nz` square cells of `cell` m from `origin`
 * (the [x, z] corner with the least x and z), row-major by z; `h` the highest surface or tree top in each
 * cell, rounded up to the metre (0 where there is nothing).
 */
export type DroneSky = {
	origin: [number, number];
	cell: number;
	nx: number;
	nz: number;
	h: number[];
};

export type HeroProps = {
	version: number;
	fps: number;
	/** First and last Blender frame of the hero move: [1, 250]. */
	frames: [number, number];
	/** Vertical FOV of the Blender camera at 16:9, in degrees. */
	base_vfov_deg: number;
	/** tan of the half-angle the safe frame needs, at frame 250 and frame 1. */
	safe_half_tan: { f250: number; f1: number };
	/** `dir` is a unit vector from the scene toward the sun. */
	sun: { dir: Vec3 };
	lantern: Vec3;
	blimps: {
		count: number;
		radius: number;
		altitude: number;
		period_s: number;
		len: number;
		r: number;
	};
	walk_paths: Vec3[][];
	/** Node name of the well's water mesh. */
	well_water: string;
	/** Material names carrying `extras.night_emissive`. */
	night: string[];
	/** The only nodes allowed to use each restricted night material. */
	night_nodes: Record<string, string[]>;
	/** Candidate idle-person spots; absent in exports made before they existed. */
	idle_spots?: IdleSpot[];
	/** Robot routes across the view (version 2); absent in older exports. */
	robot_routes?: RobotRoute[];
	/** Conversation-circle spots (version 2); absent in older exports. */
	talk_spots?: TalkSpot[];
	/** Delivery drone drop spots (version 2); absent in older exports. */
	drone_spots?: DroneSpot[];
	/** Sky heights the drones cruise above (version 2); absent in older exports. */
	drone_sky?: DroneSky;
};

/** Required keys, nested ones dotted. Checked on load so a stale export fails loudly. */
const REQUIRED_KEYS = [
	'version',
	'fps',
	'frames',
	'base_vfov_deg',
	'safe_half_tan.f250',
	'safe_half_tan.f1',
	'sun.dir',
	'lantern',
	'blimps.count',
	'blimps.radius',
	'blimps.altitude',
	'blimps.period_s',
	'blimps.len',
	'blimps.r',
	'walk_paths',
	'well_water',
	'night',
	'night_nodes'
] as const;

function lookup(obj: unknown, path: string): unknown {
	let cur: unknown = obj;
	for (const part of path.split('.')) {
		if (cur === null || typeof cur !== 'object' || !(part in cur)) return undefined;
		cur = (cur as Record<string, unknown>)[part];
	}
	return cur;
}

/** Fetch and validate hero_props.json. Rejects naming the url and the first missing key. */
export async function loadProps(url: string, fetchFn: typeof fetch = fetch): Promise<HeroProps> {
	const res = await fetchFn(url);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	const data: unknown = await res.json();
	const missing = REQUIRED_KEYS.filter((key) => lookup(data, key) === undefined);
	if (missing.length) throw new Error(`${url}: missing key(s) ${missing.join(', ')}`);
	const props = data as HeroProps;
	if (props.idle_spots !== undefined) props.idle_spots = idleSpots(url, props.idle_spots);
	if (props.robot_routes !== undefined) props.robot_routes = robotRoutes(url, props.robot_routes);
	if (props.talk_spots !== undefined) props.talk_spots = talkSpots(url, props.talk_spots);
	if (props.drone_spots !== undefined) props.drone_spots = droneSpots(url, props.drone_spots);
	if (props.drone_sky !== undefined) props.drone_sky = droneSky(url, props.drone_sky);
	return props;
}

const isVec3 = (v: unknown): boolean =>
	Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x));
const isNums = (v: unknown, n: number): boolean =>
	Array.isArray(v) && v.length === n && v.every((x) => Number.isFinite(x));

/** Validate optional robot_routes: an array of well-formed routes, or a loud error naming the first bad one. */
function robotRoutes(url: string, routes: unknown): RobotRoute[] {
	if (!Array.isArray(routes)) throw new Error(`${url}: robot_routes is not an array`);
	routes.forEach((r, i) => {
		const ok =
			r !== null &&
			typeof r === 'object' &&
			typeof r.name === 'string' &&
			typeof r.kind === 'string' &&
			Number.isFinite(r.along) &&
			Array.isArray(r.points) &&
			r.points.length >= 2 &&
			r.points.every(isVec3) &&
			Number.isFinite(r.len) &&
			isNums(r.seen, 2) &&
			Array.isArray(r.view) &&
			r.view.every((v: unknown) => isNums(v, 3));
		if (!ok) throw new Error(`${url}: bad robot_routes[${i}]`);
	});
	return routes as RobotRoute[];
}

/** Validate optional talk_spots: an array of well-formed spots, or a loud error naming the first bad one. */
function talkSpots(url: string, spots: unknown): TalkSpot[] {
	if (!Array.isArray(spots)) throw new Error(`${url}: talk_spots is not an array`);
	spots.forEach((s, i) => {
		const ok =
			s !== null &&
			typeof s === 'object' &&
			isVec3(s.pos) &&
			Number.isFinite(s.radius) &&
			s.radius > 0;
		if (!ok) throw new Error(`${url}: bad talk_spots[${i}]`);
	});
	return spots as TalkSpot[];
}

/** Validate optional drone_spots: an array of well-formed spots, or a loud error naming the first bad one. */
function droneSpots(url: string, spots: unknown): DroneSpot[] {
	if (!Array.isArray(spots)) throw new Error(`${url}: drone_spots is not an array`);
	spots.forEach((s, i) => {
		const ok =
			s !== null &&
			typeof s === 'object' &&
			isVec3(s.pos) &&
			typeof s.kind === 'string' &&
			Array.isArray(s.frames) &&
			s.frames.every(Number.isFinite);
		if (!ok) throw new Error(`${url}: bad drone_spots[${i}]`);
	});
	return spots as DroneSpot[];
}

/** Validate optional drone_sky: a grid whose `h` has nx * nz heights, or a loud error. */
function droneSky(url: string, sky: unknown): DroneSky {
	const g = sky as DroneSky;
	const ok =
		g !== null &&
		typeof g === 'object' &&
		isNums(g.origin, 2) &&
		g.cell > 0 &&
		Number.isInteger(g.nx) &&
		Number.isInteger(g.nz) &&
		g.nx > 0 &&
		g.nz > 0 &&
		isNums(g.h, g.nx * g.nz);
	if (!ok) throw new Error(`${url}: bad drone_sky`);
	return g;
}

/** Validate optional idle_spots: an array of well-formed spots, or a loud error naming the first bad one. */
function idleSpots(url: string, spots: unknown): IdleSpot[] {
	if (!Array.isArray(spots)) throw new Error(`${url}: idle_spots is not an array`);
	spots.forEach((s, i) => {
		const ok =
			s !== null &&
			typeof s === 'object' &&
			(s.pose === 'sit' || s.pose === 'lean') &&
			Array.isArray(s.pos) &&
			s.pos.length === 3 &&
			s.pos.every(Number.isFinite) &&
			Number.isFinite(s.heading) &&
			(s.pose === 'lean' || Number.isFinite(s.drop)) &&
			(s.top === undefined || s.top === null || Number.isFinite(s.top));
		if (!ok) throw new Error(`${url}: bad idle_spots[${i}]`);
	});
	return spots as IdleSpot[];
}
