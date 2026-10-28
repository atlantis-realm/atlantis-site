import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	FADE_S,
	NIGHT_GLOW_SCALE,
	NIGHT_WINDOW_SCALE,
	fadeToward,
	mixMode,
	nightEmissive,
	nightGlow
} from './night.ts';

function material(name: string, userData: Record<string, unknown> = {}): THREE.Material {
	const m = new THREE.MeshStandardMaterial();
	m.name = name;
	m.userData = userData;
	return m;
}

function near(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

test('mixMode at t = 0 is day', () => {
	assert.deepEqual(mixMode(0), { sun: 3, ambient: 1, emissive: 0, bloom: 0, exposure: 1 });
});

test('mixMode at t = 1 is night', () => {
	assert.deepEqual(mixMode(1), {
		sun: 0.05,
		ambient: 0.15,
		emissive: 1,
		bloom: 0.4,
		exposure: 0.9
	});
});

test('mixMode is linear: t = 0.5 is the midpoint', () => {
	const m = mixMode(0.5);
	near(m.sun, 1.525);
	near(m.ambient, 0.575);
	near(m.emissive, 0.5);
	near(m.bloom, 0.2);
	near(m.exposure, 0.95);
});

test('mixMode clamps t to 0..1', () => {
	assert.deepEqual(mixMode(-1), mixMode(0));
	assert.deepEqual(mixMode(2), mixMode(1));
});

test('nightEmissive returns the extras tuple of a NIGHT_ material', () => {
	const m = material('NIGHT_MAT_AP_Void', { night_emissive: [1, 0.78, 0.5, 2] });
	assert.deepEqual(nightEmissive(m), [1, 0.78, 0.5, 2]);
});

test('nightEmissive is null for non-NIGHT_ materials, even with userData', () => {
	assert.equal(nightEmissive(material('MAT_AP_Cyan', { night_emissive: [0.3, 0.9, 1, 4] })), null);
	assert.equal(nightEmissive(material('MAT_AP_Cyan')), null);
});

test('nightEmissive is null for a NIGHT_ material without a valid tuple', () => {
	assert.equal(nightEmissive(material('NIGHT_Lamp')), null);
	assert.equal(nightEmissive(material('NIGHT_Lamp', { night_emissive: [1, 1, 1] })), null);
	assert.equal(nightEmissive(material('NIGHT_Lamp', { night_emissive: [1, 1, 'x', 1] })), null);
});

test('fadeToward moves t toward the target at 1 / FADE_S per second and stops there', () => {
	assert.equal(FADE_S, 1);
	near(fadeToward(0, 1, 0.25), 0.25);
	near(fadeToward(1, 0, 0.25), 0.75);
	assert.equal(fadeToward(0.9, 1, 0.5), 1);
	assert.equal(fadeToward(0.1, 0, 0.5), 0);
	assert.equal(fadeToward(1, 1, 0.5), 1);
});

test('night glows are calmer: NIGHT_GLOW_SCALE at full night, none by day', () => {
	assert.equal(NIGHT_GLOW_SCALE, 0.6);
	assert.equal(nightGlow(0), 0);
	near(nightGlow(1), 0.6);
	near(nightGlow(0.5), 0.3);
	assert.ok(mixMode(1).bloom <= 0.4, 'gentler bloom');
});

test('lit windows take the lower NIGHT_WINDOW_SCALE; other glows the shared scale', () => {
	assert.equal(NIGHT_WINDOW_SCALE, 0.3);
	near(nightGlow(1, 'NIGHT_MAT_AP_Void'), 0.3);
	near(nightGlow(1, 'NIGHT_MAT_AP_Clerestory'), 0.3);
	near(nightGlow(0.5, 'NIGHT_MAT_AP_Void'), 0.15);
	near(nightGlow(1, 'NIGHT_Lamp'), 0.6);
	near(nightGlow(1, 'NIGHT_WellRing'), 0.6);
	assert.equal(nightGlow(0, 'NIGHT_MAT_AP_Void'), 0);
});
