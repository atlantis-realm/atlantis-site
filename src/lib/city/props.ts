// hero_props.json: the scene facts the export writes next to hero.glb
// (concept-assets/city/generators/export_hero.py, "Props" step). All positions
// are in glTF space (Y up), i.e. (x, z, -y) from Blender.

export type Vec3 = [number, number, number];

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
	return data as HeroProps;
}
