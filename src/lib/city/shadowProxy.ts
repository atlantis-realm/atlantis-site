// Sun shadow casters merged into one depth-only mesh. Every caster costs a
// draw call in the shadow pass (about 110 near the plaza), which put the
// desktop frame over the 300-call budget. The city is static (the glb's only
// animation is the camera) and every material is opaque, so the casters'
// positions, baked into world space, cast the same shadow in one call.
//
// The proxy sits on PROXY_LAYER, which the camera sees only while the shadow
// map renders (installShadowLayer), so the main pass never draws it.

import * as THREE from 'three';

/** Layer of the shadow proxy: visible to the shadow pass only. */
export const SHADOW_PROXY_LAYER = 31;

const _sphere = new THREE.Sphere();
const _matrix = new THREE.Matrix4();
const _instance = new THREE.Matrix4();
const _v = new THREE.Vector3();

/**
 * Bake every mesh under `root` (and every instance of an InstancedMesh) whose
 * world bounding sphere meets `within` into one position-only, indexed mesh.
 * Returns the proxy and the meshes it replaces, or null when nothing meets `within`.
 */
export function buildShadowProxy(
	root: THREE.Object3D,
	within: THREE.Sphere,
	side: THREE.Side = THREE.DoubleSide
): { proxy: THREE.Mesh; casters: THREE.Mesh[] } | null {
	root.updateMatrixWorld(true);
	const parts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
	const casters: THREE.Mesh[] = [];

	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh || !mesh.geometry.getAttribute('position')) return;
		const geometry = mesh.geometry;
		if (!geometry.boundingSphere) geometry.computeBoundingSphere();
		const local = geometry.boundingSphere!;
		const instanced = mesh as THREE.InstancedMesh;
		let used = false;
		if (instanced.isInstancedMesh) {
			for (let i = 0; i < instanced.count; i++) {
				instanced.getMatrixAt(i, _instance);
				_matrix.multiplyMatrices(mesh.matrixWorld, _instance);
				if (!_sphere.copy(local).applyMatrix4(_matrix).intersectsSphere(within)) continue;
				parts.push({ geometry, matrix: _matrix.clone() });
				used = true;
			}
		} else if (_sphere.copy(local).applyMatrix4(mesh.matrixWorld).intersectsSphere(within)) {
			parts.push({ geometry, matrix: mesh.matrixWorld.clone() });
			used = true;
		}
		if (used) casters.push(mesh);
	});
	if (!parts.length) return null;

	let vertices = 0;
	let indices = 0;
	for (const { geometry } of parts) {
		const count = geometry.getAttribute('position').count;
		vertices += count;
		indices += geometry.index ? geometry.index.count : count;
	}
	const positions = new Float32Array(vertices * 3);
	const index = new Uint32Array(indices);
	let v = 0;
	let k = 0;
	for (const { geometry, matrix } of parts) {
		const pos = geometry.getAttribute('position');
		for (let i = 0; i < pos.count; i++) {
			_v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
			positions[(v + i) * 3] = _v.x;
			positions[(v + i) * 3 + 1] = _v.y;
			positions[(v + i) * 3 + 2] = _v.z;
		}
		if (geometry.index) {
			const src = geometry.index;
			for (let i = 0; i < src.count; i++) index[k + i] = src.getX(i) + v;
			k += src.count;
		} else {
			for (let i = 0; i < pos.count; i++) index[k + i] = v + i;
			k += pos.count;
		}
		v += pos.count;
	}

	const merged = new THREE.BufferGeometry();
	merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	merged.setIndex(new THREE.BufferAttribute(index, 1));
	merged.computeBoundingSphere();

	// Never shaded: only the shadow pass's depth material reads it.
	const proxy = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side }));
	proxy.name = 'ShadowProxy';
	proxy.castShadow = true;
	proxy.receiveShadow = false;
	proxy.layers.set(SHADOW_PROXY_LAYER);
	return { proxy, casters };
}

/**
 * Let the camera see SHADOW_PROXY_LAYER only while the shadow map renders.
 * three.js tests shadow casters against the *main* camera's layers, after the
 * main pass has already been projected, so this hides the proxy from the
 * main pass without hiding it from the shadow pass. Returns an uninstaller.
 */
export function installShadowLayer(renderer: THREE.WebGLRenderer): () => void {
	const shadowMap = renderer.shadowMap;
	const render = shadowMap.render;
	shadowMap.render = function (lights, scene, camera) {
		const had = camera.layers.isEnabled(SHADOW_PROXY_LAYER);
		camera.layers.enable(SHADOW_PROXY_LAYER);
		try {
			render.call(this, lights, scene, camera);
		} finally {
			if (!had) camera.layers.disable(SHADOW_PROXY_LAYER);
		}
	};
	return () => {
		shadowMap.render = render;
	};
}
