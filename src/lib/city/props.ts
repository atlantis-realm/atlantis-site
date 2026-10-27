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
	/** Which part of the scene: 'well' (within WELL_AREA_R of the well: the walkway round it), 'avenue' or 'other'. */
	area?: string;
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
	return props;
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
			(s.pose === 'lean' || Number.isFinite(s.drop));
		if (!ok) throw new Error(`${url}: bad idle_spots[${i}]`);
	});
	return spots as IdleSpot[];
}
