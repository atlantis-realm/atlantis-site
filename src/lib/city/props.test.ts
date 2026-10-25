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
