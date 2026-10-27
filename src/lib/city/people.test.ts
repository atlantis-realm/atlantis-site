import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	castFromScene,
	createCharacterPeople,
	createPeople,
	mulberry32,
	parsePeopleMeta,
	planWalkers,
	walkInfluences,
	walkKey,
	walkerPose,
	weightedPick,
	type PeopleMeta
} from './people.ts';
import type { Vec3 } from './props.ts';

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
