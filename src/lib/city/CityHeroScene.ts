// Three.js scene for the /city hero: loads the exported glb, scrubs its baked
// `Hero` camera animation from the scroll position, and draws the procedural
// sky. Follows the DicePreviewScene pattern (class owning renderer, scene,
// timer and RAF loop, torn down by destroy()).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
	HERO_FRAME_END,
	HERO_FRAME_START,
	easeToward,
	frameToTime,
	safeFrameFov,
	scrollToFrame
} from './heroCamera.ts';
import { loadProps, type HeroProps } from './props.ts';
import { createSky, setSkySun, type Sky } from './sky.ts';

/** Device pixel ratio cap (budget: 1.5). */
export const MAX_PIXEL_RATIO = 1.5;
/** Name of the camera node and its animation clip in hero.glb. */
export const HERO_CAMERA_NODE = 'HeroCamera';
export const HERO_CLIP = 'Hero';

/** Sun light (day). */
const SUN_COLOR = 0xfff1dc;
const SUN_INTENSITY = 2.6;
/** Environment (PMREM of the sky) strength on the city's materials. */
const ENV_INTENSITY = 1.0;
/** Shadows: a square this many metres either side of the plaza, desktop only. */
const SHADOW_HALF_SIZE = 150;
const SHADOW_MAP_SIZE = 2048;
/** How far back along the sun direction the shadow camera sits. */
const SHADOW_LIGHT_DISTANCE = 600;
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.05;

export type CityHeroOptions = {
	reducedMotion: boolean;
	mobile: boolean;
};

export type CityHeroMode = 'day' | 'night';

/** `safe_half_tan` interpolated linearly by frame, from f1 at frame 1 to f250 at frame 250. */
export function safeHalfTanAt(frame: number, safe: HeroProps['safe_half_tan']): number {
	const u = THREE.MathUtils.clamp(
		(frame - HERO_FRAME_START) / (HERO_FRAME_END - HERO_FRAME_START),
		0,
		1
	);
	return safe.f1 + (safe.f250 - safe.f1) * u;
}

export class CityHeroScene {
	private readonly canvas: HTMLCanvasElement;
	private readonly opts: CityHeroOptions;
	private readonly scene = new THREE.Scene();
	private readonly renderer: THREE.WebGLRenderer;
	private readonly timer = new THREE.Timer();
	private readonly sky: Sky;
	private readonly sun: THREE.DirectionalLight;
	private camera: THREE.PerspectiveCamera;
	private mixer: THREE.AnimationMixer | null = null;
	private action: THREE.AnimationAction | null = null;
	private envTarget: THREE.WebGLRenderTarget | null = null;
	private animationFrameId: number | null = null;
	private destroyed = false;

	private aspect = 16 / 9;
	private frame = HERO_FRAME_END;
	private targetFrame = HERO_FRAME_END;
	private skyTime = 0;
	private mode: CityHeroMode = 'day';

	private loadedProps: HeroProps | null = null;
	private loadedRoot: THREE.Group | null = null;

	constructor(canvas: HTMLCanvasElement, opts: CityHeroOptions) {
		this.canvas = canvas;
		this.opts = opts;

		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.mobile });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.shadowMap.enabled = !opts.mobile;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;

		// Placeholder until the glb's HeroCamera arrives.
		this.camera = new THREE.PerspectiveCamera(33, this.aspect, 0.2, 8000);

		this.sky = createSky();
		this.scene.add(this.sky.mesh);

		this.sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
		this.scene.add(this.sun, this.sun.target);

		this.timer.connect(document);

		const { clientWidth, clientHeight } = canvas;
		if (clientWidth > 0 && clientHeight > 0) this.resize(clientWidth, clientHeight);
		this.start();
	}

	/** hero_props.json, once load() has resolved. */
	get props(): HeroProps | null {
		return this.loadedProps;
	}

	/** The glTF scene, once load() has resolved. */
	get root(): THREE.Group | null {
		return this.loadedRoot;
	}

	async load(glbUrl: string, propsUrl: string): Promise<void> {
		const loader = new GLTFLoader();
		loader.setMeshoptDecoder(MeshoptDecoder);
		const [props, gltf] = await Promise.all([loadProps(propsUrl), loader.loadAsync(glbUrl)]);
		if (this.destroyed) {
			disposeObject(gltf.scene);
			return;
		}

		const camera = findCamera(gltf.scene.getObjectByName(HERO_CAMERA_NODE));
		if (!camera) throw new Error(`${glbUrl}: no perspective camera node "${HERO_CAMERA_NODE}"`);
		const clip = THREE.AnimationClip.findByName(gltf.animations, HERO_CLIP);
		if (!clip) throw new Error(`${glbUrl}: no animation clip "${HERO_CLIP}"`);

		this.loadedProps = props;
		this.loadedRoot = gltf.scene;
		this.camera = camera;
		this.scene.add(gltf.scene);

		// Paused and time-driven: setFrameTime() sets action.time and applies it
		// with mixer.update(0). (mixer.setTime() zeroes action.time, which a paused
		// action never advances again.)
		this.mixer = new THREE.AnimationMixer(gltf.scene);
		this.action = this.mixer.clipAction(clip);
		this.action.play();
		this.action.paused = true;

		this.prepareMaterials(gltf.scene);

		const sunDir = new THREE.Vector3(...props.sun.dir).normalize();
		setSkySun(this.sky, sunDir);
		this.setFrameTime(this.frame);
		this.sky.uniforms.uCityDir.value.copy(this.cityDirection(props));
		this.placeSun(sunDir, gltf.scene);
		this.bakeEnvironment();
		this.resize(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);
	}

	/** Scroll progress 0..1 → frame target (250..1). */
	setScroll(progress: number): void {
		this.targetFrame = scrollToFrame(progress);
	}

	resize(w: number, h: number): void {
		if (w <= 0 || h <= 0) return;
		this.aspect = w / h;
		this.renderer.setSize(w, h, false);
		this.updateProjection();
	}

	/** Day only for now; Task 7 adds the night mode. */
	setMode(mode: CityHeroMode): void {
		this.mode = mode;
	}

	getMode(): CityHeroMode {
		return this.mode;
	}

	/** Draw calls and triangles of the last rendered frame. */
	stats(): { calls: number; triangles: number } {
		const { calls, triangles } = this.renderer.info.render;
		return { calls, triangles };
	}

	/** Current (eased) Blender frame. */
	getFrame(): number {
		return this.frame;
	}

	private updateProjection(): void {
		this.camera.aspect = this.aspect;
		const props = this.loadedProps;
		if (props) {
			const halfTan = safeHalfTanAt(this.frame, props.safe_half_tan);
			this.camera.fov = safeFrameFov(this.aspect, props.base_vfov_deg, halfTan);
		}
		this.camera.updateProjectionMatrix();
	}

	private setFrameTime(frame: number): void {
		if (!this.mixer || !this.action) return;
		const t = THREE.MathUtils.clamp(frameToTime(frame), 0, this.action.getClip().duration);
		this.action.time = t;
		this.mixer.update(0);
	}

	/** COLOR_0 carries the baked AO; make sure every material that has it uses it. */
	private prepareMaterials(root: THREE.Object3D): void {
		const castShadows = !this.opts.mobile;
		const plaza = this.plazaCentre(root);
		const shadowSphere = new THREE.Sphere(plaza, SHADOW_HALF_SIZE * Math.SQRT2);
		const bounds = new THREE.Sphere();
		root.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (!mesh.isMesh) return;
			if (mesh.geometry.getAttribute('color')) {
				for (const m of materialsOf(mesh)) {
					if (!m.vertexColors) {
						m.vertexColors = true;
						m.needsUpdate = true;
					}
				}
			}
			if (!castShadows) return;
			mesh.receiveShadow = true;
			// Only meshes near the plaza cast: the shadow map covers just that area,
			// and every caster costs a draw call in the shadow pass.
			const instanced = mesh as THREE.InstancedMesh;
			// InstancedMesh bounds cover all instances; plain meshes use their geometry's.
			if (instanced.isInstancedMesh) instanced.computeBoundingSphere();
			else if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
			const local = instanced.isInstancedMesh
				? instanced.boundingSphere
				: mesh.geometry.boundingSphere;
			if (!local) return;
			bounds.copy(local).applyMatrix4(mesh.matrixWorld);
			mesh.castShadow = bounds.intersectsSphere(shadowSphere);
		});
	}

	/** The well (props.well_water) marks the plaza; fall back to the first walk path's centre. */
	private plazaCentre(root: THREE.Object3D): THREE.Vector3 {
		root.updateMatrixWorld(true);
		const centre = new THREE.Vector3();
		const water = this.loadedProps && root.getObjectByName(this.loadedProps.well_water);
		if (water) return new THREE.Box3().setFromObject(water).getCenter(centre);
		const ring = this.loadedProps?.walk_paths[0] ?? [];
		for (const p of ring) centre.add(new THREE.Vector3(...p));
		return ring.length ? centre.divideScalar(ring.length) : centre;
	}

	/** Horizontal direction from the camera's start (frame 250) toward the Lantern. */
	private cityDirection(props: HeroProps): THREE.Vector3 {
		const from = this.camera.getWorldPosition(new THREE.Vector3());
		const dir = new THREE.Vector3(...props.lantern).sub(from);
		dir.y = 0;
		return dir.lengthSq() > 1e-6 ? dir.normalize() : new THREE.Vector3(0, 0, -1);
	}

	private placeSun(sunDir: THREE.Vector3, root: THREE.Object3D): void {
		const centre = this.plazaCentre(root);
		this.sun.position.copy(centre).addScaledVector(sunDir, SHADOW_LIGHT_DISTANCE);
		this.sun.target.position.copy(centre);
		this.sun.target.updateMatrixWorld();
		if (this.opts.mobile) return;

		this.sun.castShadow = true;
		const shadow = this.sun.shadow;
		shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
		shadow.bias = SHADOW_BIAS;
		shadow.normalBias = SHADOW_NORMAL_BIAS;
		const cam = shadow.camera;
		cam.left = cam.bottom = -SHADOW_HALF_SIZE;
		cam.right = cam.top = SHADOW_HALF_SIZE;
		cam.near = 1;
		cam.far = SHADOW_LIGHT_DISTANCE * 2;
		cam.updateProjectionMatrix();
	}

	/** Environment map from a sky-only scene (reflections and ambient light). */
	private bakeEnvironment(): void {
		const pmrem = new THREE.PMREMGenerator(this.renderer);
		const skyScene = new THREE.Scene();
		skyScene.add(this.sky.cloneMesh());
		const target = pmrem.fromScene(skyScene);
		pmrem.dispose();
		this.envTarget?.dispose();
		this.envTarget = target;
		this.scene.environment = target.texture;
		this.scene.environmentIntensity = ENV_INTENSITY;
	}

	private tick = (timestamp: number): void => {
		if (this.destroyed) return;

		this.timer.update(timestamp);
		const delta = this.timer.getDelta();

		const prev = this.frame;
		this.frame = this.opts.reducedMotion
			? this.targetFrame
			: easeToward(this.frame, this.targetFrame, delta);
		if (this.frame !== prev) {
			this.setFrameTime(this.frame);
			this.updateProjection();
		}

		if (!this.opts.reducedMotion) this.skyTime += delta;
		this.sky.update(this.skyTime);

		this.renderer.render(this.scene, this.camera);
		this.animationFrameId = requestAnimationFrame(this.tick);
	};

	start(): void {
		if (this.animationFrameId != null) return;
		this.animationFrameId = requestAnimationFrame(this.tick);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;

		if (this.animationFrameId != null) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}

		this.timer.disconnect();
		this.mixer?.stopAllAction();
		if (this.loadedRoot) disposeObject(this.loadedRoot);
		this.sky.dispose();
		this.envTarget?.dispose();
		this.scene.clear();
		this.scene.environment = null;
		this.renderer.dispose();
	}
}

function findCamera(node: THREE.Object3D | undefined): THREE.PerspectiveCamera | null {
	let found: THREE.PerspectiveCamera | null = null;
	node?.traverse((obj) => {
		if (!found && (obj as THREE.PerspectiveCamera).isPerspectiveCamera) {
			found = obj as THREE.PerspectiveCamera;
		}
	});
	return found;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
	return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

const TEXTURE_KEYS = [
	'map',
	'normalMap',
	'roughnessMap',
	'metalnessMap',
	'aoMap',
	'emissiveMap'
] as const;

function disposeObject(root: THREE.Object3D): void {
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh) return;
		mesh.geometry.dispose();
		for (const m of materialsOf(mesh)) {
			const rec = m as unknown as Record<string, THREE.Texture | null | undefined>;
			for (const key of TEXTURE_KEYS) rec[key]?.dispose();
			m.dispose();
		}
	});
}
