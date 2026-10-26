import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SHADOW_PROXY_LAYER, buildShadowProxy, installShadowLayer } from './shadowProxy.ts';

const NEAR = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 50);

function box(x: number): THREE.Mesh {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
	mesh.position.set(x, 0, 0);
	return mesh;
}

test('merges near meshes and near instances into one world-space proxy, skipping far ones', () => {
	const root = new THREE.Group();
	root.position.set(0, 10, 0);
	const near = box(5);
	const far = box(500);
	const inst = new THREE.InstancedMesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial(),
		3
	);
	inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-10, 0, 0));
	inst.setMatrixAt(1, new THREE.Matrix4().makeTranslation(900, 0, 0));
	inst.setMatrixAt(2, new THREE.Matrix4().makeTranslation(0, 0, 20));
	root.add(near, far, inst);

	const built = buildShadowProxy(root, NEAR);
	assert.ok(built);
	const { proxy, casters } = built;
	assert.deepEqual(new Set(casters), new Set([near, inst]));

	const boxVerts = new THREE.BoxGeometry(1, 1, 1).getAttribute('position').count; // 24
	const boxIdx = new THREE.BoxGeometry(1, 1, 1).index!.count; // 36
	const pos = proxy.geometry.getAttribute('position');
	assert.equal(pos.count, boxVerts * 3, 'one mesh + two instances');
	assert.equal(proxy.geometry.index!.count, boxIdx * 3);
	assert.ok(proxy.geometry.index!.array instanceof Uint32Array);
	assert.equal(Object.keys(proxy.geometry.attributes).join(), 'position');

	// Baked into world space: the near box spans x 4..6 at y 9..11 (root at y = 10).
	const bbox = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
	assert.deepEqual(bbox.min.toArray(), [-10.5, 9, -1]);
	assert.deepEqual(bbox.max.toArray(), [6, 11, 20.5]);
	// Indices of the later parts are offset past the earlier vertices.
	const idx = proxy.geometry.index!.array;
	assert.ok(Math.max(...idx) === pos.count - 1);

	assert.equal(proxy.castShadow, true);
	assert.equal(proxy.receiveShadow, false);
	assert.equal((proxy.material as THREE.Material).side, THREE.DoubleSide);
	assert.ok(proxy.layers.isEnabled(SHADOW_PROXY_LAYER));
	assert.ok(!proxy.layers.isEnabled(0), 'hidden from a default camera');
});

test('non-indexed geometry gets a sequential index', () => {
	const root = new THREE.Group();
	root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()));
	const built = buildShadowProxy(root, NEAR)!;
	const idx = Array.from(built.proxy.geometry.index!.array);
	assert.deepEqual(
		idx,
		idx.map((_, i) => i)
	);
});

test('returns null when nothing is near', () => {
	const root = new THREE.Group();
	root.add(box(1000));
	assert.equal(buildShadowProxy(root, NEAR), null);
});

test('installShadowLayer shows the proxy layer to the camera only during shadowMap.render', () => {
	const seen: boolean[] = [];
	const shadowMap = {
		render(_l: unknown, _s: unknown, camera: THREE.Camera) {
			seen.push(camera.layers.isEnabled(SHADOW_PROXY_LAYER));
		}
	};
	const original = shadowMap.render;
	const renderer = { shadowMap } as unknown as THREE.WebGLRenderer;
	const camera = new THREE.PerspectiveCamera();
	const uninstall = installShadowLayer(renderer);
	renderer.shadowMap.render([], new THREE.Scene(), camera);
	assert.deepEqual(seen, [true]);
	assert.ok(!camera.layers.isEnabled(SHADOW_PROXY_LAYER));
	uninstall();
	assert.equal(renderer.shadowMap.render, original);
});
