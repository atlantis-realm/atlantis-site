import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPeople, mulberry32, planWalkers, walkerPose } from './people.ts';
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
	assert.ok(one.mesh instanceof THREE.InstancedMesh);
	assert.equal(one.mesh.count, 80);
	assert.ok(one.mesh.instanceColor, 'instance colours');
	one.update(12.5);
	two.update(12.5);
	assert.deepEqual([...one.mesh.instanceMatrix.array], [...two.mesh.instanceMatrix.array]);
	const before = [...one.mesh.instanceMatrix.array];
	one.update(13.5);
	assert.notDeepEqual([...one.mesh.instanceMatrix.array], before);
	// Figures are about 1.75 m tall.
	one.mesh.geometry.computeBoundingBox();
	const h = one.mesh.geometry.boundingBox!.max.y - one.mesh.geometry.boundingBox!.min.y;
	assert.ok(Math.abs(h - 1.75) < 0.01, `height ${h}`);
});
