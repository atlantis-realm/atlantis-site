import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	ROBOT_COUNT,
	ROBOT_NIGHT_GLOW,
	ROBOT_RESPAWN_GAP,
	ROBOT_TURN_LOOK,
	ROUTE_VIEW_SLACK,
	createRobots,
	loadRobotAsset,
	parseRobotMeta,
	pickIndex,
	pickRoute,
	routeInView,
	routePose,
	robotWalkTime,
	type RobotMeta
} from './robot.ts';
import { mulberry32 } from './people.ts';
import type { RobotRoute, Vec3 } from './props.ts';

const META: RobotMeta = {
	version: 2,
	height: 4,
	walk_cycle_m: 3.6,
	walk_duration_s: 1.2,
	idle_duration_s: 1.3,
	palettes: ['p0', 'p1', 'p2', 'p3'],
	variants: [
		{ name: 'ROBOT_V0', height: 4, walk_cycle_m: 3.6 },
		{ name: 'ROBOT_V1', height: 4.1, walk_cycle_m: 2.4 }
	]
};

/** A straight route along +X at depth z, `len` m long (points 2 m apart), stepping up 0.6 m over x 10..12. */
function route(name: string, z: number, len: number, view: [number, number, number][]): RobotRoute {
	const points = Array.from({ length: len / 2 + 1 }, (_, k) => {
		const x = -len / 2 + 2 * k;
		return [x, x >= 12 ? 0.6 : 0, z] as Vec3;
	});
	return { name, kind: 'street', along: -z, points, len, seen: [8, len - 8], view };
}
/** street_a in view at frames 1..96, street_b only at 1..36, street_c at 1..96. */
const ROUTES: RobotRoute[] = [
	route('street_a', -50, 40, [
		[1, 8, 32],
		[46, 8, 32],
		[71, 8, 32],
		[96, 8, 32]
	]),
	route('street_b', -300, 60, [
		[1, 8, 52],
		[36, 8, 52]
	]),
	route('street_c', -320, 50, [
		[1, 8, 42],
		[66, 8, 42],
		[96, 8, 42]
	])
];

function close(a: number[], b: number[], eps = 1e-9): void {
	assert.equal(a.length, b.length);
	a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < eps, `[${k}] ${v} vs ${b[k]}`));
}

/** Smallest signed difference a − b of two angles. */
function angleDiff(a: number, b: number): number {
	return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

test('parseRobotMeta accepts the bake and rejects a stale or bad file', () => {
	assert.deepEqual(parseRobotMeta(structuredClone(META)), META);
	assert.throws(() => parseRobotMeta(null), /robot_meta.json/);
	assert.throws(() => parseRobotMeta({ ...META, walk_duration_s: 'x' }), /robot_meta.json/);
	// Version 1 (one robot, no variants or palettes) is stale.
	const v1: Partial<RobotMeta> = { ...META, version: 1 };
	delete v1.variants;
	delete v1.palettes;
	assert.throws(() => parseRobotMeta(v1), /robot_meta.json/);
	assert.throws(() => parseRobotMeta({ ...META, variants: [] }), /robot_meta.json/);
	assert.throws(() => parseRobotMeta({ ...META, palettes: [] }), /robot_meta.json/);
	assert.throws(
		() => parseRobotMeta({ ...META, variants: [{ name: 'ROBOT_V0', height: 4, walk_cycle_m: 0 }] }),
		/robot_meta.json/
	);
});

test('robotWalkTime: the walk clip advances one loop per walk_cycle_m walked, wrapping', () => {
	assert.equal(robotWalkTime(0, 3.6, 1.2), 0);
	assert.ok(Math.abs(robotWalkTime(1.8, 3.6, 1.2) - 0.6) < 1e-9);
	assert.ok(Math.abs(robotWalkTime(3.6 + 0.9, 3.6, 1.2) - 0.3) < 1e-9);
	assert.ok(Math.abs(robotWalkTime(-0.9, 3.6, 1.2) - 0.9) < 1e-9);
	// A shorter stride loops the clip sooner over the same distance.
	assert.ok(Math.abs(robotWalkTime(1.2, 2.4, 1.2) - 0.6) < 1e-9);
});

test('routeInView: a sample frame within ROUTE_VIEW_SLACK of the frame sees it', () => {
	const [a, b] = ROUTES;
	assert.ok(routeInView(a, 46));
	assert.ok(routeInView(a, 46 + ROUTE_VIEW_SLACK));
	assert.ok(!routeInView(b, 36 + ROUTE_VIEW_SLACK + 1));
	assert.ok(routeInView(b, 40));
	assert.ok(!routeInView(b, 200));
	assert.ok(!routeInView({ ...b, view: [] }, 1));
});

test('pickRoute prefers routes in view, never a busy one while another is free', () => {
	const counts = [0, 0, 0];
	const rand = mulberry32(1);
	for (let i = 0; i < 300; i++) counts[pickRoute(ROUTES, 70, rand, new Set())]++;
	// At frame 70 street_b is out of view: only a and c are picked, both often.
	assert.equal(counts[1], 0);
	assert.ok(counts[0] > 100 && counts[2] > 100, `${counts}`);
	// Busy routes are skipped, even an in-view one for an out-of-view one.
	for (let i = 0; i < 50; i++) assert.equal(pickRoute(ROUTES, 70, rand, new Set([0, 2])), 1);
	for (let i = 0; i < 50; i++) assert.equal(pickRoute(ROUTES, 70, rand, new Set([0])), 2);
	// Nothing in view (frame 200): any free route.
	const seen = new Set<number>();
	for (let i = 0; i < 100; i++) seen.add(pickRoute(ROUTES, 200, rand, new Set([1])));
	assert.deepEqual([...seen].sort(), [0, 2]);
	// Every route busy: one of them all the same.
	assert.ok([0, 1, 2].includes(pickRoute(ROUTES, 70, rand, new Set([0, 1, 2]))));
});

test('pickIndex avoids the given indices while it can', () => {
	const rand = mulberry32(2);
	const seen = new Set<number>();
	for (let i = 0; i < 200; i++) {
		const k = pickIndex(5, rand, [1, 3]);
		assert.ok(k !== 1 && k !== 3 && k >= 0 && k < 5);
		seen.add(k);
	}
	assert.deepEqual([...seen].sort(), [0, 2, 4]);
	assert.equal(pickIndex(1, rand, [0]), 0);
	assert.ok([0, 1].includes(pickIndex(2, rand, [0, 1])));
});

test('routePose: on the polyline, riding its steps, facing along it; reversed faces back; smooth on an arc', () => {
	const pts = ROUTES[0].points; // x −20..20 at z −50, y 0 then 0.6 from x 12
	const mid = routePose(pts, 7);
	close(mid.position, [-13, 0, -50]);
	close([Math.sin(mid.heading), Math.cos(mid.heading)], [1, 0], 1e-9); // walking +X
	// Half way up the 0.6 m step between x 10 and 12 (distance runs along the slope).
	close(routePose(pts, 30 + Math.hypot(2, 0.6) / 2).position, [11, 0.3, -50]);
	// Clamped at the ends.
	close(routePose(pts, -5).position, pts[0]);
	close(routePose(pts, 99).position, pts[pts.length - 1]);
	const back = routePose([...pts].reverse(), 7);
	close(back.position, [13, 0.6, -50]);
	close([Math.sin(back.heading), Math.cos(back.heading)], [-1, 0], 1e-9);
	// Round a 30 m radius arc in 2 m chords: the heading turns 0.25 / r rad per 0.25 m, never jumping.
	const arc: Vec3[] = Array.from({ length: 31 }, (_, k) => {
		const a = (k * 2) / 30;
		return [30 * Math.sin(a), 0, 30 * Math.cos(a)] as Vec3;
	});
	let prev = routePose(arc, ROBOT_TURN_LOOK).heading;
	let maxStep = 0;
	for (let d = ROBOT_TURN_LOOK + 0.25; d < 58 - ROBOT_TURN_LOOK; d += 0.25) {
		const h = routePose(arc, d).heading;
		maxStep = Math.max(maxStep, Math.abs(angleDiff(h, prev)));
		prev = h;
	}
	assert.ok(maxStep < (0.25 / 30) * 1.5, `max heading step ${maxStep}`);
});

/**
 * A stand-in robot.glb scene: two variant meshes (ROBOT_V0, ROBOT_V1) skinned to one two-bone rig sharing one
 * material with a palette map, and a 'walk' clip moving the child bone.
 */
function fakeRobot(): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
	const scene = new THREE.Group();
	const root = new THREE.Bone();
	const knee = new THREE.Bone();
	knee.name = 'knee';
	knee.position.y = 1;
	root.add(knee);
	scene.add(root);
	const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
	for (const name of ['ROBOT_V0', 'ROBOT_V1']) {
		const geometry = new THREE.BoxGeometry(1, 2, 1);
		const count = geometry.getAttribute('position').count;
		geometry.setAttribute(
			'skinIndex',
			new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4)
		);
		geometry.setAttribute(
			'skinWeight',
			new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4)
		);
		const mesh = new THREE.SkinnedMesh(geometry, material);
		mesh.name = name;
		mesh.bind(new THREE.Skeleton([root, knee]));
		scene.add(mesh);
	}
	const track = new THREE.NumberKeyframeTrack('knee.position[y]', [0, 0.6, 1.2], [1, 2, 1]);
	return { scene, animations: [new THREE.AnimationClip('walk', 1.2, [track])] };
}

type Seen = { route: string; reversed: boolean; variant: number; palette: number };

test('createRobots: ROBOT_COUNT robots crossing on different routes, re-rolled every pass', () => {
	assert.equal(ROBOT_COUNT, 2);
	const { scene, animations } = fakeRobot();
	const robots = createRobots(scene, animations, META, ROUTES, { shadows: true })!;
	assert.ok(robots);
	assert.equal(robots.object.children.length, ROBOT_COUNT);

	const passes: Seen[][] = [[], []];
	let gaps = 0;
	for (let t = 0; t < 600; t += 0.5) {
		robots.update(t, 70);
		const states = robots.state();
		assert.equal(states.length, ROBOT_COUNT);
		const live = states.filter((s) => s.visible);
		// Two at once are never on the same route.
		if (live.length === 2) assert.notEqual(live[0].route, live[1].route);
		states.forEach((s, i) => {
			const clone = robots.object.children[i];
			assert.equal(clone.visible, s.visible);
			if (!s.visible) {
				gaps++;
				return;
			}
			// At frame 70 street_b is out of view, and the other two are free for the two robots.
			assert.notEqual(s.route, 'street_b');
			const r = ROUTES.find((x) => x.name === s.route)!;
			const pts = s.reversed ? [...r.points].reverse() : r.points;
			const pose = routePose(pts, s.distance);
			close(clone.position.toArray(), pose.position, 1e-6);
			assert.ok(Math.abs(angleDiff(clone.rotation.y, pose.heading)) < 1e-9);
			// Exactly the pass's variant mesh is shown, with the pass's palette.
			const shown: THREE.Object3D[] = [];
			clone.traverse((c) => {
				if ((c as THREE.Mesh).isMesh && c.visible) shown.push(c);
			});
			assert.deepEqual(
				shown.map((c) => c.name),
				[META.variants[s.variant].name]
			);
			const map = ((shown[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).map!;
			assert.ok(Math.abs(map.offset.x - s.palette / META.palettes.length) < 1e-12);
			const last = passes[i][passes[i].length - 1];
			const cur = { route: s.route, reversed: s.reversed, variant: s.variant, palette: s.palette };
			if (!last || JSON.stringify(last) !== JSON.stringify(cur)) passes[i].push(cur);
		});
	}
	assert.ok(gaps > 0, 'no gap between passes');
	for (const list of passes) {
		assert.ok(list.length >= 8, `${list.length} passes`);
		// Both directions, both variants and every palette over the run.
		assert.deepEqual([...new Set(list.map((p) => p.reversed))].sort(), [false, true]);
		assert.deepEqual([...new Set(list.map((p) => p.variant))].sort(), [0, 1]);
		assert.equal(new Set(list.map((p) => p.palette)).size, META.palettes.length);
		// A new pass never repeats the last pass's palette.
		for (let k = 1; k < list.length; k++) assert.notEqual(list[k].palette, list[k - 1].palette);
	}
	robots.dispose();
});

test('createRobots: speed and clip time follow the variant stride; frozen with the clock; deterministic', () => {
	const run = () => {
		const { scene, animations } = fakeRobot();
		const robots = createRobots(scene, animations, META, ROUTES, { shadows: false })!;
		const knee = robots.object.children[0].getObjectByName('knee')!;
		const out: number[][] = [];
		let prev: { t: number; distance: number; route: string } | null = null;
		for (let t = 0; t < 120; t += 0.25) {
			robots.update(t, 20);
			const s = robots.state()[0];
			if (!s.visible) {
				prev = null;
				continue;
			}
			const v = META.variants[s.variant];
			// The clip time robotWalkTime gives for the distance at the variant's stride (knee 0 → 1, 0.6 → 2).
			const ct = robotWalkTime(s.distance, v.walk_cycle_m, 1.2);
			const want = ct <= 0.6 ? 1 + ct / 0.6 : 2 - (ct - 0.6) / 0.6;
			assert.ok(Math.abs(knee.position.y - want) < 1e-5, `t ${t}: ${knee.position.y} vs ${want}`);
			// Ground speed: walk_cycle_m / walk_duration_s of the variant, within a pass.
			if (prev && prev.route === s.route && s.distance > prev.distance)
				assert.ok(
					Math.abs(s.distance - prev.distance - ((t - prev.t) * v.walk_cycle_m) / 1.2) < 1e-9
				);
			prev = { t, distance: s.distance, route: s.route };
			out.push([s.distance, s.variant, s.palette, robots.object.children[0].position.x]);
		}
		// The same time twice (reduced motion): nothing moves.
		robots.update(50.5, 20);
		const p = robots.object.children[1].position.clone();
		robots.update(50.5, 20);
		assert.ok(robots.object.children[1].position.equals(p));
		robots.dispose();
		return out;
	};
	const first = run();
	assert.ok(first.length > 100);
	assert.deepEqual(run(), first);
});

test('createRobots: shadows, the night glow and dispose', () => {
	const { scene, animations } = fakeRobot();
	const robots = createRobots(scene, animations, META, ROUTES, { shadows: true })!;
	robots.update(3, 20);
	const materials = new Set<THREE.MeshStandardMaterial>();
	let shadows = 0;
	robots.object.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh) return;
		if (mesh.castShadow && mesh.receiveShadow) shadows++;
		materials.add(mesh.material as THREE.MeshStandardMaterial);
	});
	assert.equal(shadows, 2 * ROBOT_COUNT);
	// One material per robot (its palette offset), glowing with its own map at night.
	assert.equal(materials.size, ROBOT_COUNT);
	for (const m of materials) {
		assert.equal(m.emissiveIntensity, 0);
		assert.equal(m.emissiveMap, m.map);
	}
	robots.setNight(1);
	for (const m of materials) assert.equal(m.emissiveIntensity, ROBOT_NIGHT_GLOW);
	robots.setNight(0);
	for (const m of materials) assert.equal(m.emissiveIntensity, 0);
	robots.dispose();
	assert.equal(robots.object.children.length, 0);
});

test('createRobots: no robots without a walk clip, routes or the variant meshes', () => {
	const { scene, animations } = fakeRobot();
	assert.equal(createRobots(fakeRobot().scene, [], META, ROUTES, { shadows: false }), null);
	assert.equal(createRobots(fakeRobot().scene, animations, META, [], { shadows: false }), null);
	assert.equal(
		createRobots(fakeRobot().scene, animations, META, undefined, { shadows: false }),
		null
	);
	const other = { ...META, variants: [{ name: 'ROBOT_V9', height: 4, walk_cycle_m: 3 }] };
	assert.equal(createRobots(scene, animations, other, ROUTES, { shadows: false }), null);
});

test('loadRobotAsset: no robot.glb or robot_meta.json, no robot (null, one warning each)', async () => {
	const warn = console.warn;
	const warnings: unknown[] = [];
	console.warn = (...args: unknown[]) => warnings.push(args);
	try {
		const missing = { loadAsync: () => Promise.reject(new Error('404 robot.glb')) };
		const notFound = () => Promise.resolve(new Response('', { status: 404 }));
		const okMeta = () => Promise.resolve(new Response(JSON.stringify(META)));
		const { scene, animations } = fakeRobot();
		const glb = { loadAsync: () => Promise.resolve({ scene, animations }) };
		const urls = ['/city/robot.glb', '/city/robot_meta.json'] as const;
		assert.equal(await loadRobotAsset(missing, ...urls, notFound), null);
		assert.equal(await loadRobotAsset(missing, ...urls, okMeta), null);
		assert.equal(await loadRobotAsset(glb, ...urls, notFound), null);
		assert.equal(warnings.length, 3);
		const asset = await loadRobotAsset(glb, ...urls, okMeta);
		assert.ok(asset && asset.scene === scene && asset.meta.variants.length === 2);
	} finally {
		console.warn = warn;
	}
});

test('ROBOT_RESPAWN_GAP is a short hidden pause', () => {
	assert.ok(ROBOT_RESPAWN_GAP[0] > 0 && ROBOT_RESPAWN_GAP[1] >= ROBOT_RESPAWN_GAP[0]);
	assert.ok(ROBOT_RESPAWN_GAP[1] <= 5);
});
