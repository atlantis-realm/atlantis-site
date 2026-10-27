import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProps, type HeroProps } from './props.ts';

const SAMPLE: HeroProps = {
	version: 1,
	fps: 24,
	frames: [1, 250],
	base_vfov_deg: 33.166444,
	safe_half_tan: { f250: 0.299848, f1: 0.529412 },
	sun: { dir: [0.512, 0.683, 0.5209] },
	lantern: [0, 84, -1168],
	blimps: { count: 6, radius: 600, altitude: 280, period_s: 240, len: 45, r: 7.65 },
	walk_paths: [
		[
			[10, 8.62, 1210],
			[9.9, 8.62, 1208.7]
		]
	],
	well_water: 'HERO_well_water',
	night: ['NIGHT_Lamp', 'NIGHT_MAT_AP_Void'],
	night_nodes: {
		NIGHT_MAT_AP_Cyan: ['NBHD_core_lantern'],
		NIGHT_WellRing: ['KIT_Walkway_inlay0']
	}
};

function stubFetch(body: unknown, status = 200): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		assert.equal(String(input), '/city/hero_props.json');
		return new Response(JSON.stringify(body), { status });
	}) as typeof fetch;
}

test('loadProps returns the typed props object', async () => {
	const props = await loadProps('/city/hero_props.json', stubFetch(SAMPLE));
	assert.deepEqual(props, SAMPLE);
	assert.equal(props.safe_half_tan.f250, 0.299848);
	assert.equal(props.sun.dir.length, 3);
});

test('loadProps rejects with a clear error when a top-level key is missing', async () => {
	const broken: Partial<HeroProps> = { ...SAMPLE };
	delete broken.sun;
	await assert.rejects(
		loadProps('/city/hero_props.json', stubFetch(broken)),
		/hero_props\.json.*missing.*sun/
	);
});

test('loadProps rejects with a clear error when a nested key is missing', async () => {
	const broken = { ...SAMPLE, safe_half_tan: { f250: 0.3 } };
	await assert.rejects(
		loadProps('/city/hero_props.json', stubFetch(broken)),
		/missing.*safe_half_tan\.f1/
	);
});

test('loadProps rejects on an HTTP error', async () => {
	await assert.rejects(loadProps('/city/hero_props.json', stubFetch({}, 404)), /404/);
});

test('loadProps accepts props without idle_spots (older exports)', async () => {
	const props = await loadProps('/city/hero_props.json', stubFetch(SAMPLE));
	assert.equal(props.idle_spots, undefined);
});

test('loadProps keeps well-formed idle_spots', async () => {
	const idle_spots: HeroProps['idle_spots'] = [
		{ pose: 'sit', pos: [1, 8.4, 1200], heading: 1.5, drop: 0.45, area: 'well' },
		{ pose: 'lean', pos: [23, 8.9, 1100], heading: -1.57, area: 'avenue' }
	];
	const props = await loadProps('/city/hero_props.json', stubFetch({ ...SAMPLE, idle_spots }));
	assert.deepEqual(props.idle_spots, idle_spots);
});

test('loadProps rejects a malformed idle spot', async () => {
	for (const bad of [
		{ pose: 'stand', pos: [0, 0, 0], heading: 0 },
		{ pose: 'sit', pos: [0, 0, 0], heading: 0 },
		{ pose: 'lean', pos: [0, 0], heading: 0 },
		{ pose: 'lean', pos: [0, 0, 0], heading: 'north' }
	]) {
		await assert.rejects(
			loadProps('/city/hero_props.json', stubFetch({ ...SAMPLE, idle_spots: [bad] })),
			/bad idle_spots\[0\]/
		);
	}
	await assert.rejects(
		loadProps('/city/hero_props.json', stubFetch({ ...SAMPLE, idle_spots: {} })),
		/idle_spots is not an array/
	);
});

test('loadProps keeps a lean spot top: a height or null (tall wall)', async () => {
	const idle_spots: HeroProps['idle_spots'] = [
		{ pose: 'lean', pos: [-11.9, 8.62, 1209], heading: 1.57, top: 1.128, area: 'well' },
		{ pose: 'lean', pos: [23, 8.9, 1100], heading: -1.57, top: null, area: 'avenue' }
	];
	const props = await loadProps('/city/hero_props.json', stubFetch({ ...SAMPLE, idle_spots }));
	assert.deepEqual(props.idle_spots, idle_spots);
	await assert.rejects(
		loadProps(
			'/city/hero_props.json',
			stubFetch({ ...SAMPLE, idle_spots: [{ ...idle_spots[0], top: 'high' }] })
		),
		/bad idle_spots\[0\]/
	);
});

const ROUTE: NonNullable<HeroProps['robot_routes']>[number] = {
	name: 'street_57',
	kind: 'street',
	along: 57,
	points: [
		[-28, 9.07, 1153],
		[0, 9.69, 1153],
		[28, 9.07, 1153]
	],
	len: 56,
	seen: [8, 48],
	view: [
		[1, 8, 48],
		[96, 12, 44]
	]
};

test('loadProps accepts props without robot_routes or talk_spots (older exports)', async () => {
	const props = await loadProps('/city/hero_props.json', stubFetch(SAMPLE));
	assert.equal(props.robot_routes, undefined);
	assert.equal(props.talk_spots, undefined);
});

test('loadProps keeps well-formed robot_routes and talk_spots', async () => {
	const talk_spots: HeroProps['talk_spots'] = [
		{ pos: [8.5, 8.62, 1210], radius: 2.2, area: 'well' }
	];
	const props = await loadProps(
		'/city/hero_props.json',
		stubFetch({ ...SAMPLE, version: 2, robot_routes: [ROUTE], talk_spots })
	);
	assert.deepEqual(props.robot_routes, [ROUTE]);
	assert.deepEqual(props.talk_spots, talk_spots);
});

test('loadProps rejects a malformed robot route', async () => {
	for (const bad of [
		{ ...ROUTE, points: [[0, 0, 0]] },
		{
			...ROUTE,
			points: [
				[0, 0, 0],
				[1, 0]
			]
		},
		{ ...ROUTE, len: 'long' },
		{ ...ROUTE, seen: [8] },
		{ ...ROUTE, view: [[1, 8]] },
		{ ...ROUTE, name: 3 }
	]) {
		await assert.rejects(
			loadProps('/city/hero_props.json', stubFetch({ ...SAMPLE, robot_routes: [bad] })),
			/bad robot_routes\[0\]/
		);
	}
	await assert.rejects(
		loadProps('/city/hero_props.json', stubFetch({ ...SAMPLE, robot_routes: {} })),
		/robot_routes is not an array/
	);
});

test('loadProps rejects a malformed talk spot', async () => {
	for (const bad of [
		{ pos: [0, 0], radius: 2 },
		{ pos: [0, 0, 0], radius: 0 },
		{ pos: [0, 0, 0] }
	]) {
		await assert.rejects(
			loadProps('/city/hero_props.json', stubFetch({ ...SAMPLE, talk_spots: [bad] })),
			/bad talk_spots\[0\]/
		);
	}
	await assert.rejects(
		loadProps('/city/hero_props.json', stubFetch({ ...SAMPLE, talk_spots: 'none' })),
		/talk_spots is not an array/
	);
});

const SKY: NonNullable<HeroProps['drone_sky']> = {
	origin: [-8, 1100],
	cell: 8,
	nx: 2,
	nz: 2,
	h: [0, 12, 40, 9]
};
const DRONE_SPOT: NonNullable<HeroProps['drone_spots']>[number] = {
	pos: [4, 9, 1204],
	kind: 'ground',
	frames: [1, 6, 11]
};

test('loadProps accepts props without drone_spots or drone_sky (older exports)', async () => {
	const props = await loadProps('/city/hero_props.json', stubFetch(SAMPLE));
	assert.equal(props.drone_spots, undefined);
	assert.equal(props.drone_sky, undefined);
});

test('loadProps keeps well-formed drone_spots and drone_sky', async () => {
	const props = await loadProps(
		'/city/hero_props.json',
		stubFetch({ ...SAMPLE, drone_spots: [DRONE_SPOT], drone_sky: SKY })
	);
	assert.deepEqual(props.drone_spots, [DRONE_SPOT]);
	assert.deepEqual(props.drone_sky, SKY);
});

test('loadProps rejects a malformed drone spot or sky grid', async () => {
	for (const bad of [
		{ ...DRONE_SPOT, pos: [1, 2] },
		{ ...DRONE_SPOT, kind: 3 },
		{ ...DRONE_SPOT, frames: [1, 'x'] }
	]) {
		await assert.rejects(
			loadProps('/city/hero_props.json', stubFetch({ ...SAMPLE, drone_spots: [bad] })),
			/bad drone_spots\[0\]/
		);
	}
	for (const bad of [
		{ ...SKY, h: [0, 1, 2] },
		{ ...SKY, cell: 0 },
		{ ...SKY, origin: [1] }
	]) {
		await assert.rejects(
			loadProps('/city/hero_props.json', stubFetch({ ...SAMPLE, drone_sky: bad })),
			/bad drone_sky/
		);
	}
});
