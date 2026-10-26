import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BLIMP_BOB_M, blimpPose, createBlimps, updateBlimps } from './blimps.ts';
import type { HeroProps } from './props.ts';

const B: HeroProps['blimps'] = { count: 6, radius: 600, altitude: 280, period_s: 240, len: 45, r: 7.65 };
const CENTRE: [number, number, number] = [0, 84, -1168];

function angleOf(i: number, t: number): number {
	const { position } = blimpPose(i, t, B, CENTRE);
	return Math.atan2(position[2] - CENTRE[2], position[0] - CENTRE[0]);
}

/** Angle difference wrapped to (−π, π]. */
function wrap(a: number): number {
	return Math.atan2(Math.sin(a), Math.cos(a));
}

test('every blimp stays at the orbit radius from the centre', () => {
	for (const t of [0, 1.3, 37, 120, 239.9, 1000]) {
		for (let i = 0; i < B.count; i++) {
			const [x, , z] = blimpPose(i, t, B, CENTRE).position;
			const d = Math.hypot(x - CENTRE[0], z - CENTRE[2]);
			assert.ok(Math.abs(d - B.radius) < 1e-6, `blimp ${i} at t=${t}: ${d}`);
		}
	}
});

test('at t = 0 the blimps are evenly spaced', () => {
	const step = (2 * Math.PI) / B.count;
	for (let i = 0; i < B.count; i++) {
		assert.ok(Math.abs(wrap(angleOf(i, 0) - i * step)) < 1e-9, `blimp ${i}`);
	}
});

test('after a quarter period every blimp has advanced π/2', () => {
	for (let i = 0; i < B.count; i++) {
		const advanced = wrap(angleOf(i, B.period_s / 4) - angleOf(i, 0));
		assert.ok(Math.abs(advanced - Math.PI / 2) < 1e-9, `blimp ${i}: ${advanced}`);
	}
});

test('the bob stays within ±4 m of the altitude', () => {
	assert.equal(BLIMP_BOB_M, 4);
	let lo = Infinity;
	let hi = -Infinity;
	for (let k = 0; k <= 2000; k++) {
		const t = k * 0.25;
		for (let i = 0; i < B.count; i++) {
			const y = blimpPose(i, t, B, CENTRE).position[1] - B.altitude;
			lo = Math.min(lo, y);
			hi = Math.max(hi, y);
		}
	}
	assert.ok(lo >= -4 - 1e-9 && hi <= 4 + 1e-9, `bob ${lo}..${hi}`);
	assert.ok(hi - lo > 7, 'the blimps do bob');
});

test('yaw points the nose (+X) along the direction of travel', () => {
	const dt = 1e-3;
	for (let i = 0; i < B.count; i++) {
		const a = blimpPose(i, 10, B, CENTRE);
		const b = blimpPose(i, 10 + dt, B, CENTRE);
		const travel = new THREE.Vector3(b.position[0] - a.position[0], 0, b.position[2] - a.position[2]).normalize();
		const nose = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), a.yaw);
		assert.ok(nose.dot(travel) > 1 - 1e-6, `blimp ${i}: ${nose.dot(travel)}`);
	}
});

test('createBlimps: one instanced mesh of count hulls, len long and 2r wide', () => {
	const mesh = createBlimps(B);
	assert.ok(mesh.isInstancedMesh);
	assert.equal(mesh.count, B.count);
	mesh.geometry.computeBoundingBox();
	const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
	assert.ok(Math.abs(size.x - B.len) < 1e-6, `length ${size.x}`);
	assert.ok(size.z >= 2 * B.r - 1e-6, `width ${size.z}`);
	mesh.geometry.dispose();
	(mesh.material as THREE.Material).dispose();
});

test('updateBlimps places each instance at its pose', () => {
	const mesh = createBlimps(B);
	updateBlimps(mesh, B, CENTRE, 50);
	const m = new THREE.Matrix4();
	const p = new THREE.Vector3();
	for (let i = 0; i < B.count; i++) {
		mesh.getMatrixAt(i, m);
		p.setFromMatrixPosition(m);
		const want = blimpPose(i, 50, B, CENTRE).position;
		assert.ok(p.distanceTo(new THREE.Vector3(...want)) < 1e-3, `instance ${i}`);
	}
	mesh.geometry.dispose();
	(mesh.material as THREE.Material).dispose();
});
