import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	CONVO_SIZE,
	IDLE_GAP,
	LEAN_FWD_TOLERANCE,
	SIT_DROP_TOLERANCE,
	castFromScene,
	castWeights,
	convoTalkers,
	createCharacterPeople,
	createPeople,
	idlerPose,
	mulberry32,
	parsePeopleMeta,
	pickBotSlots,
	planConvos,
	planIdlers,
	planWalkers,
	walkInfluences,
	walkKey,
	walkerPose,
	weightedPick,
	type PeopleMeta
} from './people.ts';
import type { IdleSpot, TalkSpot, Vec3 } from './props.ts';

/** A closed 10 m square (first point == last point): perimeter 40 m. */
const SQUARE: Vec3[] = [
	[0, 0, 0],
	[10, 0, 0],
	[10, 0, 10],
	[0, 0, 10],
	[0, 0, 0]
];
/** An open 100 m line along +X, raised to y = 2. */
const LINE: Vec3[] = [
	[0, 2, 0],
	[40, 2, 0],
	[100, 2, 0]
];

function close(a: number[], b: number[], eps = 1e-9): void {
	assert.equal(a.length, b.length);
	a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < eps, `[${k}] ${v} vs ${b[k]}`));
}

test('on a closed loop, s = 0 and s = perimeter give the same position', () => {
	close(walkerPose(SQUARE, 0).position, walkerPose(SQUARE, 40).position);
	close(walkerPose(SQUARE, 13).position, walkerPose(SQUARE, 53).position);
	close(walkerPose(SQUARE, -3).position, walkerPose(SQUARE, 37).position);
	close(walkerPose(SQUARE, 15).position, [10, 0, 5]);
});

test('on an open 100 m line, s = 150 sits at the 50 m point (ping-pong)', () => {
	close(walkerPose(LINE, 150).position, [50, 2, 0]);
	close(walkerPose(LINE, 50).position, [50, 2, 0]);
	close(walkerPose(LINE, 200).position, [0, 2, 0]);
	close(walkerPose(LINE, 230).position, [30, 2, 0]);
});

test('heading points along the segment direction', () => {
	// heading is a yaw about +Y: local +Z turns to (sin h, 0, cos h).
	const dir = (h: number): number[] => [Math.sin(h), Math.cos(h)];
	close(dir(walkerPose(SQUARE, 5).heading), [1, 0]); // +X
	close(dir(walkerPose(SQUARE, 15).heading), [0, 1]); // +Z
	close(dir(walkerPose(SQUARE, 25).heading), [-1, 0]); // −X
	close(dir(walkerPose(SQUARE, 35).heading), [0, -1]); // −Z
	// Ping-pong: walking back the heading turns round.
	close(dir(walkerPose(LINE, 50).heading), [1, 0]);
	close(dir(walkerPose(LINE, 150).heading), [-1, 0]);
});

test('mulberry32 is deterministic and in [0, 1)', () => {
	const a = mulberry32(7);
	const b = mulberry32(7);
	for (let k = 0; k < 100; k++) {
		const v = a();
		assert.equal(v, b());
		assert.ok(v >= 0 && v < 1);
	}
	assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

const OPTS = { perPath: 40, speed: [1, 1.5] as [number, number] };

test('the same seed gives the same layout', () => {
	const a = planWalkers([SQUARE, LINE], OPTS);
	const b = planWalkers([SQUARE, LINE], OPTS);
	assert.equal(a.length, 80);
	assert.deepEqual(a, b);
	for (const w of a) assert.ok(w.speed >= 1 && w.speed <= 1.5, `speed ${w.speed}`);
	// Keyed by path index: the square's walkers don't depend on the paths after it.
	assert.deepEqual(planWalkers([SQUARE], OPTS), a.slice(0, 40));
	// And two paths at different indices get different layouts.
	const twice = planWalkers([SQUARE, SQUARE], OPTS);
	assert.notDeepEqual(
		twice.slice(0, 40).map((w) => w.s0),
		twice.slice(40).map((w) => w.s0)
	);
});

test('createPeople builds one instanced mesh that update() moves the same way every load', () => {
	const one = createPeople([SQUARE, LINE], OPTS);
	const two = createPeople([SQUARE, LINE], OPTS);
	assert.equal(one.meshes.length, 1);
	const [mesh] = one.meshes;
	assert.ok(mesh instanceof THREE.InstancedMesh);
	assert.equal(mesh.count, 80);
	assert.ok(mesh.instanceColor, 'instance colours');
	one.update(12.5);
	two.update(12.5);
	assert.deepEqual([...mesh.instanceMatrix.array], [...two.meshes[0].instanceMatrix.array]);
	const before = [...mesh.instanceMatrix.array];
	one.update(13.5);
	assert.notDeepEqual([...mesh.instanceMatrix.array], before);
	// Figures are about 1.75 m tall.
	mesh.geometry.computeBoundingBox();
	const h = mesh.geometry.boundingBox!.max.y - mesh.geometry.boundingBox!.min.y;
	assert.ok(Math.abs(h - 1.75) < 0.01, `height ${h}`);
	one.dispose();
	two.dispose();
});

test('walkKey steps through the keys once per cycle and wraps', () => {
	const K = 6;
	const cycle = 1.2;
	assert.equal(walkKey(0, cycle, K), 0);
	assert.equal(walkKey(0.199, cycle, K), 0);
	assert.equal(walkKey(0.2, cycle, K), 1);
	assert.equal(walkKey(1.19, cycle, K), 5);
	assert.equal(walkKey(1.2, cycle, K), 0); // wraps
	assert.equal(walkKey(1.2 * 7 + 0.5, cycle, K), 2);
	assert.equal(walkKey(-0.1, cycle, K), 5); // negative distances wrap too
	// Every key appears, in order, over one cycle.
	const seen = Array.from({ length: 60 }, (_, k) => walkKey((k * cycle) / 60, cycle, K));
	assert.deepEqual([...new Set(seen)], [0, 1, 2, 3, 4, 5]);
	for (let d = -5; d < 5; d += 0.01) {
		const key = walkKey(d, cycle, K);
		assert.ok(Number.isInteger(key) && key >= 0 && key < K, `key ${key} at ${d}`);
	}
});

test('walkInfluences is one key at exactly 1, every other 0 (no blending)', () => {
	for (let key = 0; key < 6; key++) {
		const w = walkInfluences(key, 6);
		assert.equal(w.length, 6);
		assert.equal(w[key], 1);
		assert.equal(w.filter((v) => v === 1).length, 1);
		assert.equal(w.filter((v) => v === 0).length, 5);
	}
	// Reuses `out`.
	const out = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
	assert.equal(walkInfluences(2, 6, out), out);
	assert.deepEqual(out, [0, 0, 1, 0, 0, 0]);
});

test('weightedPick follows the cumulative weights', () => {
	assert.equal(weightedPick(undefined, 0.7), 0);
	assert.equal(weightedPick([1, 1], 0.49), 0);
	assert.equal(weightedPick([1, 1], 0.5), 1);
	assert.equal(weightedPick([1, 0.5, 1], 0.45), 1);
	assert.equal(weightedPick([1, 0.5, 1], 0.6), 2);
	assert.equal(weightedPick([1, 1, 1], 0.9999999), 2);
});

/** A 2 m tall box with K morph targets (target k lifts it k cm), named PEOPLE_<name>. */
function fakeGlb(names: string[], keys: number, material: THREE.Material): THREE.Group {
	const root = new THREE.Group();
	names.forEach((name, n) => {
		const geometry = new THREE.BoxGeometry(0.5, 2, 0.3).translate(0, 1, 0);
		const count = geometry.getAttribute('position').count;
		geometry.morphAttributes.position = Array.from({ length: keys }, (_, k) => {
			const a = new Float32Array(count * 3);
			for (let v = 0; v < count; v++) a[v * 3 + 1] = k / 100;
			return new THREE.BufferAttribute(a, 3);
		});
		geometry.morphTargetsRelative = true;
		const mesh = new THREE.Mesh(geometry, material);
		mesh.name = `PEOPLE_${name}`;
		mesh.position.set(n, 0, 0);
		root.add(mesh);
	});
	return root;
}

const META: PeopleMeta = {
	version: 1,
	keys: 6,
	cycle_m: 1.3,
	variants: [
		{ name: 'A', height: 2, kind: null, cycle_m: 1.4 },
		{ name: 'B', height: 2, kind: 'Police' },
		{ name: 'C', height: 2, kind: null }
	]
};

test('parsePeopleMeta rejects a wrong file', () => {
	assert.equal(parsePeopleMeta(META), META);
	assert.throws(() => parsePeopleMeta({ ...META, keys: 0 }));
	assert.throws(() => parsePeopleMeta({ ...META, variants: [] }));
	assert.throws(() => parsePeopleMeta(null));
});

test('castFromScene finds every variant with its node transform and cycle', () => {
	const material = new THREE.MeshStandardMaterial();
	const cast = castFromScene(fakeGlb(['A', 'B', 'C'], 6, material), META);
	assert.deepEqual(
		cast.members.map((m) => [m.name, m.cycleM, m.uniform, m.matrix.elements[12]]),
		[
			['A', 1.4, false, 0],
			['B', 1.3, true, 1],
			['C', 1.3, false, 2]
		]
	);
	assert.equal(cast.material, material);
	assert.throws(() => castFromScene(fakeGlb(['A', 'B'], 6, material), META), /PEOPLE_C/);
	assert.throws(() => castFromScene(fakeGlb(['A', 'B', 'C'], 4, material), META), /4 morph/);
});

test('createCharacterPeople: one instanced mesh per variant, seeded, one key at 1 per walker', () => {
	const make = () =>
		createCharacterPeople(
			[SQUARE, LINE],
			OPTS,
			castFromScene(fakeGlb(['A', 'B', 'C'], 6, new THREE.MeshStandardMaterial()), META)
		);
	const one = make();
	const two = make();
	// Every walker is drawn once, by a mesh of its own variant.
	assert.equal(
		one.meshes.reduce((n, m) => n + m.count, 0),
		80
	);
	assert.ok(one.meshes.length >= 2 && one.meshes.length <= 3, `${one.meshes.length} meshes`);
	assert.deepEqual(
		one.meshes.map((m) => [m.name, m.count]),
		two.meshes.map((m) => [m.name, m.count])
	);
	// Uniforms are picked at half a civilian's weight.
	const count = (name: string) => one.meshes.find((m) => m.name === `People_${name}`)?.count ?? 0;
	assert.ok(count('B') < count('A') && count('B') < count('C'), `B ${count('B')}`);

	one.update(12.5);
	two.update(12.5);
	one.meshes.forEach((mesh, n) => {
		assert.deepEqual([...mesh.instanceMatrix.array], [...two.meshes[n].instanceMatrix.array]);
		const K = 7; // base influence + 6 keys per instance row
		const data = mesh.morphTexture!.image.data as Float32Array;
		for (let k = 0; k < mesh.count; k++) {
			const row = [...data.slice(k * K + 1, k * K + K)];
			assert.equal(row.filter((v) => v === 1).length, 1, `instance ${k}: ${row}`);
			assert.equal(row.filter((v) => v === 0).length, 5, `instance ${k}: ${row}`);
		}
	});

	// The key changes as the walkers walk, and the texture is flagged only then.
	const mesh = one.meshes[0];
	const before = [...(mesh.morphTexture!.image.data as Float32Array)];
	const version = mesh.morphTexture!.version;
	one.update(12.5);
	assert.equal(mesh.morphTexture!.version, version, 'no change, no upload');
	one.update(12.8);
	assert.notDeepEqual([...(mesh.morphTexture!.image.data as Float32Array)], before);
	assert.ok(mesh.morphTexture!.version > version);

	// The node's transform is applied under the walker's: variant A's node sits at the origin,
	// so an A instance stands on its path's height (the square, y = 0, or the line, y = 2).
	const a = one.meshes.find((m) => m.name === 'People_A')!;
	const m = new THREE.Matrix4();
	a.getMatrixAt(0, m);
	assert.ok([0, 2].includes(Math.round(m.elements[13] * 1e6) / 1e6), `y ${m.elements[13]}`);
	one.dispose();
	two.dispose();
});

/** Version 2 meta: sit and lean targets after the 6 walk keys, with each variant's pose measures. */
const META2: PeopleMeta = {
	...META,
	version: 2,
	poses: { sit: 6, lean: 7 },
	variants: META.variants.map((v, n) => ({
		...v,
		sit_seat_h: 0.45 - n * 0.02,
		sit_edge: 0.3,
		lean_back: 0.2
	}))
};
const BODY = { seatH: 0.45, sitEdge: 0.3, leanBack: 0.2 };
const FWD_BODY = { ...BODY, fwdFront: 0.25, fwdTop: 1.1 };

/** `n` sit spots along x at z = 0 (facing −Z, drop 0.45) and `n` lean spots at z = 20 (facing +X), 1 m apart. */
function spots(n: number): IdleSpot[] {
	const out: IdleSpot[] = [];
	for (let k = 0; k < n; k++) {
		out.push({ pose: 'sit', pos: [k, 1, 0], heading: Math.PI, drop: 0.45 });
		out.push({ pose: 'lean', pos: [k, 0, 20], heading: Math.PI / 2 });
	}
	return out;
}

test('parsePeopleMeta checks the poses and their measures', () => {
	assert.equal(parsePeopleMeta(META2), META2);
	assert.throws(() => parsePeopleMeta({ ...META2, poses: { sit: 2, lean: 7 } }));
	assert.throws(() =>
		parsePeopleMeta({ ...META2, variants: META2.variants.map(({ lean_back: _, ...v }) => v) })
	);
});

test('castFromScene with poses wants keys + 2 targets and reads the measures', () => {
	const material = new THREE.MeshStandardMaterial();
	const cast = castFromScene(fakeGlb(['A', 'B', 'C'], 8, material), META2);
	assert.equal(cast.keys, 6);
	assert.equal(cast.targets, 8);
	assert.deepEqual(cast.poses, { sit: 6, lean: 7 });
	assert.deepEqual(cast.members[1].body, { seatH: 0.43, sitEdge: 0.3, leanBack: 0.2 });
	assert.throws(() => castFromScene(fakeGlb(['A', 'B', 'C'], 6, material), META2), /6 morph/);
});

test('idlerPose: a sitter backs off the ledge edge, its seat on it; a leaner steps out from the wall', () => {
	// Facing +X (heading π/2), ledge top at y = 1.
	const sit = idlerPose({ pose: 'sit', pos: [5, 1, 3], heading: Math.PI / 2, drop: 0.45 }, BODY, 1);
	close(sit.position, [5 - 0.3, 1 - 0.45, 3]);
	assert.equal(sit.heading, Math.PI / 2);
	// Scaled: the measures scale with the figure.
	close(idlerPose({ pose: 'sit', pos: [0, 1, 0], heading: 0, drop: 0.5 }, BODY, 1.1).position, [
		0,
		1 - 0.495,
		-0.33
	]);
	// Facing −Z (heading π): the leaner's origin is lean_back out, in front of the wall foot.
	close(
		idlerPose({ pose: 'lean', pos: [2, 0, 4], heading: Math.PI }, BODY, 1).position,
		[2, 0, 3.8]
	);
});

test('planIdlers is seeded, takes the sit and lean counts asked for, keeps IDLE_GAP and fits the drops', () => {
	const bodies = [BODY, { ...BODY, seatH: 0.38 }, BODY];
	const all = spots(60);
	const a = planIdlers(all, { sit: 16, lean: 24 }, bodies, [1, 0.5, 1]);
	assert.deepEqual(a, planIdlers(all, { sit: 16, lean: 24 }, bodies, [1, 0.5, 1]));
	assert.equal(a.length, 40);
	assert.equal(a.filter((p) => p.pose === 'sit').length, 16);
	assert.equal(a.filter((p) => p.pose === 'lean').length, 24);
	a.forEach((p, i) => {
		assert.equal(p.pose, p.spot.pose);
		assert.ok(p.scale >= 0.92 && p.scale <= 1.06, `scale ${p.scale}`);
		if (p.pose === 'sit')
			assert.ok(Math.abs(p.spot.drop! - bodies[p.variant].seatH * p.scale) <= SIT_DROP_TOLERANCE);
		a.slice(i + 1).forEach((o) => {
			const d = Math.hypot(o.spot.pos[0] - p.spot.pos[0], o.spot.pos[2] - p.spot.pos[2]);
			assert.ok(d >= IDLE_GAP, `${d} m apart`);
		});
	});
	// Few sit spots: no leaners fill in for the missing sitters. A drop no seat fits: nobody sits there.
	const few = planIdlers(
		spots(60).filter((s) => s.pose === 'lean' || s.pos[0] < 3),
		{ sit: 8, lean: 3 },
		bodies
	);
	assert.ok(few.filter((p) => p.pose === 'sit').length <= 2);
	assert.equal(few.filter((p) => p.pose === 'lean').length, 3);
	const high = all.map((s) => (s.pose === 'sit' ? { ...s, drop: 1 } : s));
	assert.equal(
		planIdlers(high, { sit: 8, lean: 4 }, bodies).filter((p) => p.pose === 'sit').length,
		0
	);
	assert.deepEqual(planIdlers([], { sit: 8, lean: 4 }, bodies), []);
	// Fewer leaners don't change the sitters (they're only ever kept IDLE_GAP from each other).
	const sitters = (lean: number) =>
		planIdlers(all, { sit: 16, lean }, bodies, [1, 0.5, 1]).filter((p) => p.pose === 'sit');
	assert.deepEqual(sitters(3), sitters(24));
});

test('planIdlers: about LEAN_FWD_SHARE of the leaners lean forward, only on a rail top that fits', () => {
	const bodies = [FWD_BODY, { ...FWD_BODY, fwdTop: 0.95 }, FWD_BODY];
	// Half the lean spots are railings 1.127 m high, the rest walls too tall to lean over.
	const all = spots(60).map((s, k) =>
		s.pose === 'lean' ? { ...s, top: k % 4 === 1 ? 1.127 : null } : s
	);
	const a = planIdlers(all, { sit: 0, lean: 6 }, bodies, [1, 1, 1]);
	assert.deepEqual(a, planIdlers(all, { sit: 0, lean: 6 }, bodies, [1, 1, 1]));
	const fwd = a.filter((p) => p.pose === 'lean_fwd');
	assert.equal(fwd.length, 3);
	assert.equal(a.filter((p) => p.pose === 'lean').length, 3);
	for (const p of fwd) {
		assert.equal(p.spot.top, 1.127);
		assert.ok(p.scale >= 0.92 && p.scale <= 1.06, `scale ${p.scale}`);
		// The figure is scaled so its forearms land on the rail.
		assert.ok(Math.abs(bodies[p.variant].fwdTop! * p.scale - 1.127) <= LEAN_FWD_TOLERANCE);
	}
	// No rail tops (an old export) or no forward measures (an old bake): every leaner leans back.
	const tall = spots(60).map((s) => (s.pose === 'lean' ? { ...s, top: null } : s));
	assert.ok(planIdlers(tall, { sit: 0, lean: 6 }, bodies).every((p) => p.pose === 'lean'));
	assert.ok(
		planIdlers(all, { sit: 0, lean: 6 }, [BODY, BODY, BODY]).every((p) => p.pose === 'lean')
	);
});

test('idlerPose: a forward leaner faces the rail, its origin lean_fwd_front out from it', () => {
	// The spot faces away from the rail (+X); the forward leaner turns round to face it (−X).
	const p = idlerPose(
		{ pose: 'lean', pos: [2, 1, 4], heading: Math.PI / 2, top: 1.1 },
		FWD_BODY,
		1.1,
		true
	);
	close(p.position, [2 + 0.25 * 1.1, 1, 4]);
	close([Math.sin(p.heading), Math.cos(p.heading)], [-1, 0]);
});

/** Talk spots of radius 2.2 m on a line, 10 m apart. */
const TALK: TalkSpot[] = Array.from({ length: 6 }, (_, k) => ({
	pos: [k * 10, 0.5, -30] as Vec3,
	radius: 2.2
}));

test('planConvos: seeded groups of CONVO_SIZE people in a loose circle facing its centre', () => {
	const a = planConvos(TALK, 4, [1, 0.5, 1, 1, 1, 1]);
	assert.deepEqual(a, planConvos(TALK, 4, [1, 0.5, 1, 1, 1, 1]));
	assert.equal(a.length, 4);
	assert.equal(new Set(a.map((c) => c.spot)).size, 4, 'one group per spot');
	assert.ok(new Set(a.map((c) => c.members.length)).size > 1, 'sizes vary');
	for (const c of a) {
		const n = c.members.length;
		assert.ok(n >= CONVO_SIZE[0] && n <= CONVO_SIZE[1], `${n} people`);
		assert.equal(new Set(c.members.map((m) => m.variant)).size, n, 'different people');
		const [cx, cy, cz] = c.spot.pos;
		c.members.forEach((m, i) => {
			const [x, y, z] = m.position;
			assert.equal(y, cy);
			const r = Math.hypot(x - cx, z - cz);
			assert.ok(r >= 0.4 && r + 0.35 <= c.spot.radius, `r ${r}`);
			// Facing the centre, give or take a little.
			const facing = (Math.sin(m.heading) * (cx - x) + Math.cos(m.heading) * (cz - z)) / r;
			assert.ok(facing > Math.cos((25 * Math.PI) / 180), `facing ${facing}`);
			assert.ok(m.scale >= 0.92 && m.scale <= 1.06);
			c.members.slice(i + 1).forEach((o) => {
				const d = Math.hypot(o.position[0] - x, o.position[2] - z);
				assert.ok(d >= 0.6, `${d} m apart`);
			});
		});
	}
	// Fewer spots than groups: one group per spot.
	assert.equal(planConvos(TALK.slice(0, 2), 4).length, 2);
	assert.deepEqual(planConvos([], 4), []);
});

test('convoTalkers: stepped, seeded, at most two talking at once, everyone gets a turn', () => {
	const [c] = planConvos(TALK, 4, [1, 1, 1, 1, 1, 1]).filter((g) => g.members.length >= 3);
	assert.ok(c, 'a group of three or more');
	const spoke = new Set<number>();
	let changes = 0;
	let last = '';
	for (let t = 0; t < 600; t += 0.1) {
		const talk = convoTalkers(c, t);
		assert.equal(talk.length, c.members.length);
		assert.ok(talk.filter(Boolean).length <= 2, `t ${t}: ${talk}`);
		talk.forEach((on, k) => on && spoke.add(k));
		const key = talk.join();
		if (key !== last) changes++;
		last = key;
	}
	assert.equal(spoke.size, c.members.length, 'everyone talks some time');
	// Changes now and then, not every frame.
	assert.ok(changes > 50 && changes < 3000, `${changes} changes`);
	assert.deepEqual(convoTalkers(c, 123.4), convoTalkers(c, 123.4));
	assert.ok(convoTalkers(c, 0).some(Boolean), 'someone is talking from the start');
});

test('createCharacterPeople places idle people in the walkers meshes, posed once and held still', () => {
	const opts = { ...OPTS, idle: { sit: 8, lean: 12 }, idleSpots: spots(40) };
	const make = () =>
		createCharacterPeople(
			[SQUARE, LINE],
			opts,
			castFromScene(fakeGlb(['A', 'B', 'C'], 8, new THREE.MeshStandardMaterial()), META2)
		);
	const one = make();
	assert.ok(one.meshes.length <= 3, 'no extra meshes');
	assert.equal(
		one.meshes.reduce((n, m) => n + m.count, 0),
		80 + 20
	);
	const K = 9; // base influence + 8 targets per instance row
	const rows = () => one.meshes.map((mesh) => [...(mesh.morphTexture!.image.data as Float32Array)]);
	const poseKeys = { sit: 0, lean: 0, walk: 0 };
	for (const mesh of one.meshes) {
		const data = mesh.morphTexture!.image.data as Float32Array;
		for (let k = 0; k < mesh.count; k++) {
			const row = [...data.slice(k * K + 1, k * K + K)];
			assert.equal(row.filter((v) => v === 1).length, 1, `instance ${k}: ${row}`);
			assert.equal(row.filter((v) => v === 0).length, 7, `instance ${k}: ${row}`);
			const key = row.indexOf(1);
			if (key === 6) poseKeys.sit++;
			else if (key === 7) poseKeys.lean++;
			else poseKeys.walk++;
		}
	}
	assert.deepEqual(poseKeys, { sit: 8, lean: 12, walk: 80 });

	// An idle instance (after a mesh's walkers) keeps its matrix and key through update().
	const idleOf = (mesh: THREE.InstancedMesh) => {
		const m = new THREE.Matrix4();
		mesh.getMatrixAt(mesh.count - 1, m);
		return [...m.elements];
	};
	const before = one.meshes.map(idleOf);
	const morphBefore = rows();
	one.update(7.3);
	assert.deepEqual(one.meshes.map(idleOf), before);
	one.meshes.forEach((mesh, n) => {
		const data = mesh.morphTexture!.image.data as Float32Array;
		const last = (mesh.count - 1) * K;
		assert.deepEqual([...data.slice(last, last + K)], morphBefore[n].slice(last, last + K));
	});
	one.dispose();

	// Old meta (no poses) or no spots: walkers only.
	const old = createCharacterPeople(
		[SQUARE, LINE],
		opts,
		castFromScene(fakeGlb(['A', 'B', 'C'], 6, new THREE.MeshStandardMaterial()), META)
	);
	assert.equal(
		old.meshes.reduce((n, m) => n + m.count, 0),
		80
	);
	old.dispose();
});

/** Version 3 meta: lean_fwd, stand and talk after sit and lean, with the forward lean measures. */
const META3: PeopleMeta = {
	...META2,
	version: 3,
	poses: { sit: 6, lean: 7, lean_fwd: 8, stand: 9, talk: 10 },
	variants: META2.variants.map((v) => ({ ...v, lean_fwd_front: 0.25, lean_fwd_top: 1.1 }))
};

test('parsePeopleMeta and castFromScene read the version 3 poses and forward lean measures', () => {
	assert.equal(parsePeopleMeta(META3), META3);
	assert.throws(() =>
		parsePeopleMeta({ ...META3, variants: META3.variants.map(({ lean_fwd_top: _, ...v }) => v) })
	);
	assert.throws(() => parsePeopleMeta({ ...META3, poses: { ...META3.poses!, talk: 3 } }));
	const cast = castFromScene(fakeGlb(['A', 'B', 'C'], 11, new THREE.MeshStandardMaterial()), META3);
	assert.equal(cast.targets, 11);
	assert.deepEqual(cast.members[0].body, { ...FWD_BODY, seatH: 0.45 });
	cast.members.forEach((m) => m.geometry.dispose());
});

test('createCharacterPeople: conversations in the walkers meshes, stepping between stand and talk', () => {
	const rails = spots(40).map((s) => (s.pose === 'lean' ? { ...s, top: 1.1 } : s));
	const opts = { ...OPTS, idle: { sit: 4, lean: 4 }, idleSpots: rails, convos: 3, talkSpots: TALK };
	const one = createCharacterPeople(
		[SQUARE, LINE],
		opts,
		castFromScene(fakeGlb(['A', 'B', 'C'], 11, new THREE.MeshStandardMaterial()), META3)
	);
	assert.ok(one.meshes.length <= 3, 'no extra meshes');
	const K = 12; // base influence + 11 targets per instance row
	const keys = () => {
		const n: Record<number, number> = {};
		for (const mesh of one.meshes) {
			const data = mesh.morphTexture!.image.data as Float32Array;
			for (let k = 0; k < mesh.count; k++) {
				const row = [...data.slice(k * K + 1, k * K + K)];
				assert.equal(row.filter((v) => v === 1).length, 1, `instance ${k}: ${row}`);
				const key = row.indexOf(1);
				if (key >= 6) n[key] = (n[key] ?? 0) + 1;
			}
		}
		return n;
	};
	const total = one.meshes.reduce((n, m) => n + m.count, 0);
	const talkers = total - 80 - 8;
	// Three groups of 2..5, each with 1-2 talking at the start; 4 sit, 2 lean back, 2 forward.
	assert.ok(talkers >= 6 && talkers <= 15, `${talkers} in conversations`);
	const start = keys();
	assert.deepEqual([start[6], start[7], start[8]], [4, 2, 2]);
	assert.equal((start[9] ?? 0) + (start[10] ?? 0), talkers);
	assert.ok(start[10] >= 3 && start[10] <= 6, `${start[10]} talking`);
	// The talkers change over time (one key at 1 each still); the seated and leaning stay put.
	const snap = () =>
		one.meshes
			.flatMap((m) => {
				const data = m.morphTexture!.image.data as Float32Array;
				return Array.from({ length: m.count }, (_, k) =>
					data.slice(k * K + 1, k * K + K).indexOf(1)
				);
			})
			.filter((key) => key >= 9)
			.join();
	const before = snap();
	let changed = false;
	for (let t = 0.5; t < 30 && !changed; t += 0.5) {
		one.update(t);
		const now = keys();
		assert.deepEqual([now[6], now[7], now[8]], [4, 2, 2]);
		assert.equal((now[9] ?? 0) + (now[10] ?? 0), talkers);
		changed = snap() !== before;
	}
	assert.ok(changed, 'someone switched between stand and talk');
	one.dispose();
});

test('pickBotSlots: seeded, one slot per group, groups of three or more first', () => {
	const convos = planConvos(TALK, 4, [1, 1, 1, 1, 1, 1]);
	const a = pickBotSlots(convos, 2);
	assert.deepEqual(a, pickBotSlots(convos, 2));
	assert.equal(a.length, 2);
	assert.equal(new Set(a.map((s) => s.convo)).size, 2, 'different groups');
	const big = convos.filter((c) => c.members.length >= 3).length;
	for (const s of a.slice(0, big)) assert.ok(convos[s.convo].members.length >= 3);
	for (const s of a) assert.ok(s.member >= 0 && s.member < convos[s.convo].members.length);
	// More slots than groups: one each.
	assert.equal(pickBotSlots(convos, 10).length, convos.length);
	assert.deepEqual(pickBotSlots(convos, 0), []);
	assert.deepEqual(pickBotSlots([], 2), []);
});

test('pickBotSlots: the roomiest place in its group (its nearest neighbour furthest off)', () => {
	const convos = planConvos(TALK, 6, [1, 1, 1, 1, 1, 1]);
	const room = (c: (typeof convos)[number], k: number) =>
		Math.min(
			...c.members
				.filter((_, j) => j !== k)
				.map((m) =>
					Math.hypot(
						m.position[0] - c.members[k].position[0],
						m.position[2] - c.members[k].position[2]
					)
				)
		);
	const slots = pickBotSlots(convos, 6);
	assert.ok(
		slots.some((s) => convos[s.convo].members.length >= 4),
		'a big group is in the test'
	);
	for (const s of slots) {
		const c = convos[s.convo];
		const best = Math.max(...c.members.map((_, k) => room(c, k)));
		assert.ok(room(c, s.member) >= best - 1e-9, `convo ${s.convo}: member ${s.member}`);
	}
});

test('createCharacterPeople: botSlots hands conversation places to the minibots, the rest stay', () => {
	const opts = { ...OPTS, convos: 3, talkSpots: TALK };
	const cast = () =>
		castFromScene(fakeGlb(['A', 'B', 'C'], 11, new THREE.MeshStandardMaterial()), META3);
	const all = createCharacterPeople([SQUARE, LINE], opts, cast());
	const some = createCharacterPeople([SQUARE, LINE], { ...opts, botSlots: 2 }, cast());
	const count = (p: typeof all) => p.meshes.reduce((n, m) => n + m.count, 0);
	assert.equal(count(some), count(all) - 2);
	assert.deepEqual(all.slots, []);
	assert.equal(some.slots!.length, 2);
	const convos = planConvos(TALK, 3, castWeights(cast()));
	pickBotSlots(convos, 2).forEach((s, k) => {
		const m = convos[s.convo].members[s.member];
		assert.deepEqual(some.slots![k].position, m.position);
		assert.equal(some.slots![k].heading, m.heading);
	});
	all.dispose();
	some.dispose();
});
