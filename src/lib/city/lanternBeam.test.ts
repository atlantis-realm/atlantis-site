import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	CURTAIN_SEGMENTS,
	ENERGY_DAY_I,
	ENERGY_NIGHT_I,
	ENERGY_SPANS,
	LANTERN_DAY_GLOW,
	LANTERN_HEART_MATERIAL,
	LANTERN_HEART_OPACITY,
	LANTERN_NIGHT_GLOW,
	PULSES,
	PULSE_SPEED,
	RUNES_PER_SPAN,
	RUNE_CAP,
	buildCurtainGeometry,
	clipInsideHeart,
	createLanternEnergy,
	drawMorph,
	energyIntensity,
	findLanternHeart,
	heartBounds,
	heartGlow,
	molecule,
	moleculeAt,
	morphEase,
	prepareHeartMaterial,
	rng,
	runeTrack,
	spanPulsePhase,
	type HeartBounds
} from './lanternBeam.ts';

/** The v05 export's heart: a cylinder r 29 from y 284 to 484 at the Lantern. */
const HEART: HeartBounds = { centre: [0, 384, -1168], bottom: 284, top: 484, radius: 29 };

function near(actual: number, expected: number, eps = 1e-9): void {
	assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
}

/** A Lantern node like the export's: stone shaft and the cyan heart. */
function lanternScene(): THREE.Group {
	const root = new THREE.Group();
	const lantern = new THREE.Group();
	lantern.name = 'NBHD_core_lantern';
	const stone = new THREE.Mesh(
		new THREE.CylinderGeometry(25, 28, 482),
		new THREE.MeshStandardMaterial()
	);
	stone.material.name = 'HERO_MAT_AP_Stone';
	stone.position.set(0, 325, -1168);
	const heartMat = new THREE.MeshStandardMaterial();
	heartMat.name = LANTERN_HEART_MATERIAL;
	const heart = new THREE.Mesh(new THREE.CylinderGeometry(29, 29, 200, 32), heartMat);
	heart.position.set(0, 384, -1168);
	lantern.add(stone, heart);
	const elsewhere = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), heartMat);
	root.add(lantern, elsewhere);
	return root;
}

test('heartBounds reads the vertical cylinder from a box', () => {
	const b = heartBounds(
		new THREE.Box3(new THREE.Vector3(-29, 284, -1197), new THREE.Vector3(29, 484, -1139))
	);
	assert.deepEqual(b, HEART);
});

test('findLanternHeart finds the heart under the night_nodes Lantern node, and the rest of the Lantern', () => {
	const root = lanternScene();
	const found = findLanternHeart(root, { [LANTERN_HEART_MATERIAL]: ['NBHD_core_lantern'] });
	assert.ok(found);
	assert.equal(found.heart.length, 1);
	assert.equal(found.others.length, 1);
	assert.equal((found.others[0].material as THREE.Material).name, 'HERO_MAT_AP_Stone');
	near(found.bounds.bottom, 284);
	near(found.bounds.top, 484);
	near(found.bounds.centre[2], -1168);
	assert.ok(found.bounds.radius > 28 && found.bounds.radius <= 29);
});

test('findLanternHeart is null without the Lantern node', () => {
	assert.equal(findLanternHeart(lanternScene(), {}), null);
	assert.equal(findLanternHeart(lanternScene(), { [LANTERN_HEART_MATERIAL]: ['nope'] }), null);
});

test('prepareHeartMaterial makes a double-sided glass tube that does not hide the energy', () => {
	const m = new THREE.MeshStandardMaterial();
	prepareHeartMaterial(m);
	assert.equal(m.transparent, true);
	assert.equal(m.opacity, LANTERN_HEART_OPACITY);
	assert.ok(LANTERN_HEART_OPACITY > 0.5 && LANTERN_HEART_OPACITY < 1);
	assert.equal(m.side, THREE.DoubleSide);
	assert.equal(m.depthWrite, false);
});

test('clipInsideHeart gives the shaft its own clipping clone, shared materials elsewhere untouched', () => {
	const shared = new THREE.MeshStandardMaterial();
	const a = new THREE.Mesh(new THREE.BoxGeometry(), shared);
	const b = new THREE.Mesh(new THREE.BoxGeometry(), shared);
	const other = new THREE.Mesh(new THREE.BoxGeometry(), shared);
	clipInsideHeart([a, b], HEART);
	assert.notEqual(a.material, shared);
	assert.equal(a.material, b.material, 'one clone per source material');
	assert.equal(other.material, shared);
	const shader = {
		uniforms: {} as Record<string, THREE.IUniform>,
		vertexShader: '#include <common>\n#include <project_vertex>',
		fragmentShader: '#include <common>\n#include <clipping_planes_fragment>'
	};
	(a.material as THREE.Material).onBeforeCompile(shader as never, null as never);
	assert.match(shader.fragmentShader, /discard/);
	assert.match(shader.vertexShader, /vLanternW/);
	const clip = shader.uniforms.uLanternClip.value as THREE.Vector4;
	assert.deepEqual(clip.toArray(), [0, -1168, 286, 482]);
	assert.equal(shader.uniforms.uLanternClipR.value, 29);
});

test('the heart glows by day and, calmer than its export strength, at night', () => {
	assert.equal(heartGlow(0), LANTERN_DAY_GLOW);
	assert.equal(heartGlow(1), LANTERN_NIGHT_GLOW);
	assert.ok(LANTERN_DAY_GLOW > 0, 'lit by day');
	assert.ok(LANTERN_NIGHT_GLOW < 4 * 0.5, 'well under the export night_emissive strength 4');
	near(heartGlow(0.5), (LANTERN_DAY_GLOW + LANTERN_NIGHT_GLOW) / 2);
	assert.equal(heartGlow(-1), heartGlow(0));
	assert.equal(heartGlow(2), heartGlow(1));
});

test('energy intensity fades from day to night, below the lab night (1.65)', () => {
	assert.equal(energyIntensity(0), ENERGY_DAY_I);
	assert.equal(energyIntensity(1), ENERGY_NIGHT_I);
	assert.ok(ENERGY_NIGHT_I < 1.65);
	// The runes need uI above 0.4 to show at all (the lab's mode 4).
	assert.ok(ENERGY_DAY_I > 0.8 && ENERGY_NIGHT_I > 0.8);
});

test('the curtains are one geometry, four per span, and stay inside the heart', () => {
	const g = buildCurtainGeometry(HEART);
	const perCurtain = (CURTAIN_SEGMENTS + 1) * 2;
	const pos = g.getAttribute('position');
	assert.equal(pos.count, ENERGY_SPANS * 4 * perCurtain);
	assert.equal(g.getIndex()!.count / 3, ENERGY_SPANS * 4 * CURTAIN_SEGMENTS * 2);
	assert.ok(g.getIndex()!.count / 3 <= 2000, 'a few triangles');
	// The vertex fold moves along aFold by at most uWa (0.12 H); allow for it.
	const fold = 0.12 * HEART.radius * 0.9 * 0.95;
	for (let i = 0; i < pos.count; i++) {
		const r = Math.hypot(pos.getX(i), pos.getZ(i));
		assert.ok(r + fold < HEART.radius, `vertex ${i} at r ${r}`);
		const y = pos.getY(i) + HEART.centre[1];
		assert.ok(y > HEART.bottom && y < HEART.top, `vertex ${i} at y ${y}`);
	}
	for (const name of ['uv', 'aFold', 'aCurtain', 'aPulse']) assert.ok(g.getAttribute(name), name);
});

test('runes ride the pulse crests of their span and wrap after whole crests', () => {
	for (let s = 0; s < ENERGY_SPANS; s++) {
		for (let k = 0; k < RUNES_PER_SPAN; k++) {
			for (const t of [0, 0.7, 3.1, 12, 100]) {
				const { u } = runeTrack(k, t, s);
				// Crest: sin(u·PULSES − t·PULSE_SPEED + phase) = 1
				near(Math.sin(u * PULSES - t * PULSE_SPEED + spanPulsePhase(s)), 1, 1e-6);
			}
		}
	}
});

test('rune tracks: visible only on the span, faded at its ends, staggered between spans', () => {
	for (let i = 0; i < 400; i++) {
		const t = i * 0.37;
		const r = runeTrack(1, t, 0);
		assert.ok(r.u >= 0);
		assert.equal(r.visible, r.u < 1);
		assert.ok(r.alpha >= 0 && r.alpha <= 1);
		if (!r.visible) near(r.alpha, 0, 1e-9);
	}
	assert.notEqual(runeTrack(0, 5, 0).u, runeTrack(0, 5, 1).u);
});

test('molecules stay inside the unit rune and bonds join real atoms', () => {
	const r = rng(7);
	for (let i = 0; i < 300; i++) {
		const m = molecule(r);
		assert.equal(m.size.length, m.p.length);
		assert.equal(m.order.length, m.p.length);
		assert.deepEqual(
			[...m.order].sort((a, b) => a - b),
			m.p.map((_, j) => j)
		);
		for (const [x, y] of m.p) assert.ok(Math.abs(x) <= 0.48 + 1e-9 && Math.abs(y) <= 0.48 + 1e-9);
		for (const [a, b, o] of m.b) {
			assert.ok(a < m.p.length && b < m.p.length);
			assert.ok(o >= 1 && o <= 3);
		}
	}
});

test('moleculeAt is deterministic per rune and beat', () => {
	assert.deepEqual(moleculeAt(3, 17), moleculeAt(3, 17));
	assert.deepEqual(moleculeAt(0, -2), moleculeAt(0, -2));
	const differ = [1, 2, 3, 4, 5].some(
		(b) => JSON.stringify(moleculeAt(0, b)) !== JSON.stringify(moleculeAt(0, 0))
	);
	assert.ok(differ);
});

test('morphEase morphs in the first 35% of a beat, then holds', () => {
	assert.equal(morphEase(0), 0);
	near(morphEase(0.175), 0.5);
	assert.equal(morphEase(0.35), 1);
	assert.equal(morphEase(0.9), 1);
});

test('drawMorph draws atoms and bonds within the cap', () => {
	const A = moleculeAt(0, 0);
	const B = moleculeAt(0, 1);
	for (const e of [0, 0.3, 1]) {
		let n = 0;
		const count = drawMorph(
			(_x, _y, _a, sx, sy, sz) => {
				assert.ok(sx > 0 && sy > 0 && sz > 0);
				n++;
			},
			A,
			B,
			e,
			10,
			1.08
		);
		assert.equal(count, n);
		assert.ok(n > 0 && n <= RUNE_CAP);
	}
	assert.equal(
		drawMorph(() => {}, A, B, 0.5, 10, 1, 3),
		3
	);
});

test('createLanternEnergy: two draw calls in the heart, runes within the instance cap', () => {
	const energy = createLanternEnergy(HEART);
	const meshes: THREE.Mesh[] = [];
	energy.object.traverse((o) => {
		if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
	});
	assert.equal(meshes.length, 2);
	for (const m of meshes) assert.equal(m.renderOrder, 1, 'drawn after the heart');
	assert.deepEqual(energy.object.position.toArray(), HEART.centre);
	const runes = meshes.find(
		(m) => (m as THREE.InstancedMesh).isInstancedMesh
	) as THREE.InstancedMesh;
	let seen = 0;
	for (let i = 0; i < 200; i++) {
		energy.update(i * 0.21);
		assert.equal(runes.count, energy.runeBoxes());
		assert.ok(runes.count <= ENERGY_SPANS * RUNES_PER_SPAN * RUNE_CAP);
		seen = Math.max(seen, runes.count);
	}
	assert.ok(seen > 0, 'runes show');
	// Worst case triangles: curtains plus every rune box (12 each).
	const tris =
		ENERGY_SPANS * 4 * CURTAIN_SEGMENTS * 2 + ENERGY_SPANS * RUNES_PER_SPAN * RUNE_CAP * 12;
	assert.ok(tris < 10_000, `${tris}`);
	energy.setNight(1);
	energy.dispose();
});

test('createLanternEnergy is a pure function of time (reduced motion: one static frame)', () => {
	const a = createLanternEnergy(HEART);
	const b = createLanternEnergy(HEART);
	a.update(4.2);
	b.update(9);
	b.update(4.2);
	const ra = a.object.children[1] as THREE.InstancedMesh;
	const rb = b.object.children[1] as THREE.InstancedMesh;
	assert.equal(ra.count, rb.count);
	assert.deepEqual(
		Array.from(ra.instanceMatrix.array.slice(0, ra.count * 16)),
		Array.from(rb.instanceMatrix.array.slice(0, rb.count * 16))
	);
	a.dispose();
	b.dispose();
});
