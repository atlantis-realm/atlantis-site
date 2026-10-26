import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	MAX_WATER_LIGHTS,
	applyWater,
	nearestLights,
	setWaterLights,
	waterLights,
	waterUniforms,
	type WaterLight
} from './water.ts';
import type { Vec3 } from './props.ts';

function scene(): { root: THREE.Group; water: THREE.Mesh; canal: THREE.Mesh; base: THREE.MeshStandardMaterial } {
	const base = new THREE.MeshStandardMaterial({ color: 0x03191f, roughness: 0.22 });
	base.name = 'HERO_MAT_AP_Water';
	base.vertexColors = true;
	const water = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), base);
	water.name = 'HERO_well_water';
	// The canals share the base material and must keep it.
	const canal = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), base);
	canal.name = 'HERO_near_0_-7_HERO_MAT_AP_Water';
	const root = new THREE.Group();
	root.add(water, canal);
	return { root, water, canal, base };
}

function light(x: number, y: number, z: number): WaterLight {
	return { position: [x, y, z], color: [1, 1, 1] };
}

test('applyWater swaps the water material in on the named mesh and returns it', () => {
	const { root, water, canal, base } = scene();
	const m = applyWater(root, 'HERO_well_water');
	assert.ok(m, 'returns the material');
	assert.equal(water.material, m);
	assert.notEqual(m, base);
	assert.equal(canal.material, base, 'other meshes keep the shared base');
	const std = m as THREE.MeshStandardMaterial;
	assert.ok(std.isMeshStandardMaterial);
	assert.equal(std.color.getHex(), base.color.getHex(), 'keeps the base colour');
	assert.equal(std.vertexColors, true, 'keeps the baked AO');
	assert.equal(typeof std.onBeforeCompile, 'function');
	assert.ok(waterUniforms(std), 'carries its uniforms');
});

test('applyWater returns null when the name is missing', () => {
	const { root, water, base } = scene();
	assert.equal(applyWater(root, 'NO_SUCH_NODE'), null);
	assert.equal(water.material, base);
});

test('nearestLights returns the n nearest sorted by distance', () => {
	const origin: Vec3 = [0, 0, 0];
	const pts = [light(5, 0, 0), light(1, 0, 0), light(0, 0, -3), light(0, 9, 0), light(2, 0, 0)];
	const got = nearestLights(pts, origin, 3).map((l) => l.position[0] + l.position[1] - l.position[2]);
	assert.deepEqual(got, [1, 2, 3]);
	assert.equal(nearestLights(pts, origin, 10).length, pts.length);
	assert.equal(pts[0].position[0], 5, 'input order untouched');
});

test('nearestLights never returns more than 32', () => {
	assert.equal(MAX_WATER_LIGHTS, 32);
	const pts = Array.from({ length: 100 }, (_, i) => light(i, 0, 0));
	const got = nearestLights(pts, [0, 0, 0], 50);
	assert.equal(got.length, 32);
	assert.equal(got[31].position[0], 31);
});

test('waterLights takes night-marked instances and surfaces, nearest the origin', () => {
	const root = new THREE.Group();
	const lamp = new THREE.MeshStandardMaterial();
	lamp.name = 'NIGHT_Lamp';
	lamp.userData = { night_emissive: [1, 0.5, 0.25, 2] };
	const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), lamp, 3);
	for (let i = 0; i < 3; i++) lamps.setMatrixAt(i, new THREE.Matrix4().makeTranslation(10 * (i + 1), 0, 0));
	const ring = new THREE.MeshStandardMaterial();
	ring.name = 'NIGHT_WellRing';
	ring.userData = { night_emissive: [0, 1, 1, 4] };
	const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(5, 0.2, 4, 64), ring);
	const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
	root.add(lamps, ringMesh, plain);
	root.updateMatrixWorld(true);

	const lights = waterLights(root, [0, 0, 0]);
	assert.ok(lights.length <= MAX_WATER_LIGHTS);
	const lampLights = lights.filter((l) => l.color[0] === 2);
	assert.equal(lampLights.length, 3, 'every lamp instance is a light');
	assert.deepEqual(lampLights[0].color, [2, 1, 0.5], 'colour is rgb × strength');
	const ringLights = lights.filter((l) => l.color[2] === 4);
	assert.ok(ringLights.length > 4, `the ring is sampled around: ${ringLights.length}`);
	for (const l of ringLights) {
		const r = Math.hypot(l.position[0], l.position[1]);
		assert.ok(Math.abs(r - 5) < 1, `ring light at r=${r}`);
	}
	assert.equal(lights.length, lampLights.length + ringLights.length, 'unmarked meshes add none');
});

test('setWaterLights packs the lights into the uniform arrays', () => {
	const { root } = scene();
	const m = applyWater(root, 'HERO_well_water')!;
	setWaterLights(m, [light(1, 2, 3), { position: [4, 5, 6], color: [0.5, 0.25, 1] }]);
	const u = waterUniforms(m)!;
	assert.equal(u.uLightCount.value, 2);
	assert.equal(u.uLightPos.value.length, MAX_WATER_LIGHTS);
	assert.deepEqual(u.uLightPos.value[1].toArray(), [4, 5, 6]);
	assert.deepEqual(u.uLightColor.value[1].toArray(), [0.5, 0.25, 1]);
});
