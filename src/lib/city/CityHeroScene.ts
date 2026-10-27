// Three.js scene for the /city hero: loads the exported glb, scrubs its baked
// `Hero` camera animation from the scroll position, and draws the procedural
// sky, the day/night cross-fade (night.ts) with bloom, and the circling
// blimps (blimps.ts), the well's water (water.ts), walking, sitting and leaning people
// (people.ts: the baked characters of people.glb, or walking capsules without it) and the
// robots crossing the avenue (robot.ts, robot.glb; none without it). Follows the
// DicePreviewScene pattern (class owning renderer, scene, timer and RAF loop,
// torn down by destroy()).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
	HERO_FRAME_END,
	HERO_FRAME_START,
	easeToward,
	frameToTime,
	safeFrameFov,
	scrollToFrame
} from './heroCamera.ts';
import { loadProps, type HeroProps } from './props.ts';
import { createSky, setSkyMoon, setSkySun, type Sky } from './sky.ts';
import { DAY_MIX, fadeToward, mixMode, nightEmissive } from './night.ts';
import { createBlimps, updateBlimps } from './blimps.ts';
import { applyWater, setWaterLights, setWaterNight, setWaterTime, waterLights } from './water.ts';
import {
	IDLE_PEOPLE,
	IDLE_PEOPLE_MOBILE,
	PEOPLE_PER_PATH,
	PEOPLE_PER_PATH_MOBILE,
	WALK_SPEED,
	castFromScene,
	createCharacterPeople,
	createPeople,
	disposeCast,
	parsePeopleMeta,
	type People,
	type PeopleCast
} from './people.ts';
import { buildShadowProxy, installShadowLayer } from './shadowProxy.ts';
import { createRobots, loadRobotAsset, type RobotState, type Robots } from './robot.ts';

/** Device pixel ratio cap (budget: 1.5). */
export const MAX_PIXEL_RATIO = 1.5;
/** Name of the camera node and its animation clip in hero.glb. */
export const HERO_CAMERA_NODE = 'HeroCamera';
export const HERO_CLIP = 'Hero';
/** The baked walkers (export_people.py, people_glb.mjs); optional, capsules without them. */
export const PEOPLE_GLB_URL = '/city/people.glb';
export const PEOPLE_META_URL = '/city/people_meta.json';
/** The baked robots (export_robot.py, robot_glb.mjs); optional, no robots without them. */
export const ROBOT_GLB_URL = '/city/robot.glb';
export const ROBOT_META_URL = '/city/robot_meta.json';
/**
 * Opening framing: the baked frame-250 shot has "Welcome to Atlantis" above the
 * middle of the screen, so the camera tilts up by this much at frame 250. The
 * tilt fades out (smoothstep) over the first OPENING_AIM_FADE_FRAMES of the
 * scroll, so the rest of the move is the Blender camera unchanged.
 */
export const OPENING_PITCH_DEG = 3.6;
export const OPENING_AIM_FADE_FRAMES = 60;

/** Sun light (day). mixMode's sun level is scaled so that day gives exactly this. */
const SUN_COLOR = 0xfff1dc;
const SUN_INTENSITY = 2.6;
/** The same light at night is the moon: cool, from the sky's uMoonDir (setSkyMoon). */
const MOON_COLOR = 0xb4c4ff;
/** Environment (PMREM of the sky) strength on the city's materials. */
const ENV_INTENSITY = 1.0;
/**
 * The night sky's PMREM is ~30-45x darker than the day one (sky.ts palettes:
 * horizon luminance 0.70 vs 0.024, zenith 0.20 vs 0.0043). mixMode's ambient is a
 * level relative to day, so a night bake is scaled back up by this gain; the
 * env keeps the night sky's colour while ambient 0.15 means 15% of day.
 */
const NIGHT_ENV_GAIN = 30;
/** Shadows: a square this many metres either side of the plaza, desktop only. */
const SHADOW_HALF_SIZE = 150;
const SHADOW_MAP_SIZE = 2048;
/** How far back along the sun direction the shadow camera sits. */
const SHADOW_LIGHT_DISTANCE = 600;
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.05;
/**
 * UnrealBloomPass: strength comes from mixMode (halved on mobile). Its high pass
 * keeps whole texels above the threshold (linear, before exposure), so 2.0 sits
 * above the windows (~1.6) and bands (~1.4) and below the lamps (~2.6) and the
 * Lantern / well ring cyan (~3.1): bloom stays mild instead of hazing every facade.
 * Radius 0 weights the small mips, so the well ring at frame 250 (most of the
 * screen) glows without washing out "Welcome to Atlantis".
 */
const BLOOM_RADIUS = 0;
const BLOOM_THRESHOLD = 2.0;
const BLOOM_MOBILE_SCALE = 0.5;
/** MSAA samples of the bloom path's render target (desktop; the canvas is antialiased there too). */
const BLOOM_SAMPLES = 4;

type NightMaterial = {
	material: THREE.MeshStandardMaterial;
	emissive: [number, number, number, number];
};

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
	private readonly sunColor = new THREE.Color(SUN_COLOR);
	private readonly moonColor = new THREE.Color(MOON_COLOR);
	private readonly sunDir = new THREE.Vector3(0, 1, 0);
	private readonly plaza = new THREE.Vector3();
	private nightMaterials: NightMaterial[] = [];
	private composer: EffectComposer | null = null;
	private bloomPass: UnrealBloomPass | null = null;
	private blimps: THREE.InstancedMesh | null = null;
	private people: People | null = null;
	private robot: Robots | null = null;
	/** The well's water material (water.ts), null when the glb has no props.well_water mesh. */
	private water: THREE.Material | null = null;
	/** Merged sun-shadow casters near the plaza (shadowProxy.ts), desktop only. */
	private shadowProxy: THREE.Mesh | null = null;
	private uninstallShadowLayer: (() => void) | null = null;
	private camera: THREE.PerspectiveCamera;
	private mixer: THREE.AnimationMixer | null = null;
	private action: THREE.AnimationAction | null = null;
	private envTarget: THREE.WebGLRenderTarget | null = null;
	/** Gain of the current env bake (1 for day, NIGHT_ENV_GAIN for night), see applyMix(). */
	private envGain = 1;
	private animationFrameId: number | null = null;
	private destroyed = false;

	private aspect = 16 / 9;
	private frame = HERO_FRAME_END;
	private targetFrame = HERO_FRAME_END;
	/** Clock of the moving things (clouds, blimps, water, people, robot); frozen with reducedMotion. */
	private motionTime = 0;
	private mode: CityHeroMode = 'day';
	/** Day/night mix: 0 day, 1 night; fades toward nightTarget. */
	private night = 0;
	private nightTarget = 0;

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
		// Reset per frame in draw(), so stats() counts every pass of the bloom path.
		this.renderer.info.autoReset = false;

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

	async load(
		glbUrl: string,
		propsUrl: string,
		peopleUrl = PEOPLE_GLB_URL,
		peopleMetaUrl = PEOPLE_META_URL,
		robotUrl = ROBOT_GLB_URL,
		robotMetaUrl = ROBOT_META_URL
	): Promise<void> {
		const loader = new GLTFLoader();
		loader.setMeshoptDecoder(MeshoptDecoder);
		const [props, gltf, cast, robot] = await Promise.all([
			loadProps(propsUrl),
			loader.loadAsync(glbUrl),
			loadCast(loader, peopleUrl, peopleMetaUrl),
			loadRobotAsset(loader, robotUrl, robotMetaUrl)
		]);
		if (this.destroyed) {
			disposeObject(gltf.scene);
			if (cast) disposeCast(cast);
			if (robot) disposeObject(robot.scene);
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

		this.plazaCentre(gltf.scene, this.plaza);
		this.prepareMaterials(gltf.scene);
		this.nightMaterials = collectNightMaterials(gltf.scene);
		// After prepareMaterials, so the water's clone keeps the vertex AO.
		this.water = applyWater(gltf.scene, props.well_water);
		if (this.water) setWaterLights(this.water, waterLights(gltf.scene, this.plaza.toArray()));

		this.sunDir.set(...props.sun.dir).normalize();
		setSkySun(this.sky, this.sunDir);
		this.setFrameTime(this.frame);
		this.sky.uniforms.uCityDir.value.copy(this.cityDirection(props));
		setSkyMoon(this.sky, this.sky.uniforms.uCityDir.value);
		this.setupShadows();
		this.blimps = createBlimps(props.blimps);
		this.scene.add(this.blimps);
		const peopleOpts = {
			perPath: this.opts.mobile ? PEOPLE_PER_PATH_MOBILE : PEOPLE_PER_PATH,
			speed: WALK_SPEED,
			// Sitting and leaning at the export's idle spots; the capsules leave them out.
			idle: this.opts.mobile ? IDLE_PEOPLE_MOBILE : IDLE_PEOPLE,
			idleSpots: props.idle_spots
		};
		this.people = cast
			? createCharacterPeople(props.walk_paths, peopleOpts, cast)
			: createPeople(props.walk_paths, peopleOpts);
		for (const mesh of this.people.meshes) {
			// Small casters near the camera; the shadow map only covers the plaza anyway.
			mesh.castShadow = mesh.receiveShadow = !this.opts.mobile;
			this.scene.add(mesh);
		}
		if (robot) {
			this.robot = createRobots(robot.scene, robot.animations, robot.meta, props.robot_routes, {
				shadows: !this.opts.mobile
			});
			if (this.robot) this.scene.add(this.robot.object);
			else disposeObject(robot.scene);
		}
		this.updateMotion();
		this.applyMix();
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
		this.composer?.setSize(w, h);
		this.updateProjection();
	}

	/**
	 * Switch day/night: a cross-fade over FADE_S, instant with reducedMotion or
	 * before load. The environment map is re-baked from the sky once the fade ends.
	 */
	setMode(mode: CityHeroMode): void {
		this.mode = mode;
		this.nightTarget = mode === 'night' ? 1 : 0;
		if (this.opts.reducedMotion || !this.loadedRoot) this.stepNight(Infinity);
	}

	getMode(): CityHeroMode {
		return this.mode;
	}

	/** Draw calls and triangles of the last rendered frame. */
	stats(): { calls: number; triangles: number } {
		const { calls, triangles } = this.renderer.info.render;
		return { calls, triangles };
	}

	/** Where each robot is: its route, direction, variant, palette and distance (none before load or without robot.glb). */
	robotState(): RobotState[] {
		return this.robot?.state() ?? [];
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
		// The mixer has just rewritten the camera's quaternion, so the tilt never accumulates.
		const aim = THREE.MathUtils.smoothstep(
			frame,
			HERO_FRAME_END - OPENING_AIM_FADE_FRAMES,
			HERO_FRAME_END
		);
		if (aim > 0) this.camera.rotateX(THREE.MathUtils.degToRad(OPENING_PITCH_DEG * aim));
	}

	/** COLOR_0 carries the baked AO; make sure every material that has it uses it. */
	private prepareMaterials(root: THREE.Object3D): void {
		const castShadows = !this.opts.mobile;
		const shadowSphere = new THREE.Sphere(this.plaza, SHADOW_HALF_SIZE * Math.SQRT2);
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
			mesh.castShadow = false;
		});
		if (!castShadows) return;
		// Only meshes near the plaza cast (the shadow map covers just that area),
		// and they cast through one merged proxy: one shadow draw call instead of ~110.
		const built = buildShadowProxy(root, shadowSphere);
		if (!built) return;
		this.shadowProxy = built.proxy;
		this.scene.add(built.proxy);
		this.uninstallShadowLayer = installShadowLayer(this.renderer);
	}

	/** The well (props.well_water) marks the plaza; the export always writes it, so the origin is only a last resort. */
	private plazaCentre(root: THREE.Object3D, centre: THREE.Vector3): THREE.Vector3 {
		root.updateMatrixWorld(true);
		centre.set(0, 0, 0);
		const water = this.loadedProps && root.getObjectByName(this.loadedProps.well_water);
		return water ? new THREE.Box3().setFromObject(water).getCenter(centre) : centre;
	}

	/** Horizontal direction from the camera's start (frame 250) toward the Lantern. */
	private cityDirection(props: HeroProps): THREE.Vector3 {
		const from = this.camera.getWorldPosition(new THREE.Vector3());
		const dir = new THREE.Vector3(...props.lantern).sub(from);
		dir.y = 0;
		return dir.lengthSq() > 1e-6 ? dir.normalize() : new THREE.Vector3(0, 0, -1);
	}

	/** Aim the light at the plaza from `dir` (sun by day, moon by night). */
	private placeLight(dir: THREE.Vector3): void {
		this.sun.position.copy(this.plaza).addScaledVector(dir, SHADOW_LIGHT_DISTANCE);
		this.sun.target.position.copy(this.plaza);
		this.sun.target.updateMatrixWorld();
	}

	private setupShadows(): void {
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

	/** Advance the day/night fade by `delta` seconds; re-bake the environment when it lands. */
	private stepNight(delta: number): void {
		if (this.night === this.nightTarget) return;
		this.night = fadeToward(this.night, this.nightTarget, delta);
		this.applyMix();
		if (this.night === this.nightTarget && this.loadedRoot) this.bakeEnvironment();
	}

	/** Apply mixMode(night) to the light, environment, night list, sky, exposure and bloom. */
	private applyMix(): void {
		const t = this.night;
		const mix = mixMode(t);

		this.sun.intensity = (SUN_INTENSITY * mix.sun) / DAY_MIX.sun;
		this.sun.color.lerpColors(this.sunColor, this.moonColor, t);
		const dir = new THREE.Vector3().lerpVectors(this.sunDir, this.sky.uniforms.uMoonDir.value, t);
		this.placeLight(dir.lengthSq() > 1e-6 ? dir.normalize() : this.sunDir);

		this.updateEnvIntensity(mix.ambient);
		for (const { material, emissive } of this.nightMaterials) {
			material.emissive.setRGB(emissive[0], emissive[1], emissive[2]);
			material.emissiveIntensity = emissive[3] * mix.emissive;
		}
		this.sky.setMix(t);
		this.renderer.toneMappingExposure = mix.exposure;
		if (this.water) setWaterNight(this.water, mix.emissive);
		this.robot?.setNight(mix.emissive);

		const strength = mix.bloom * (this.opts.mobile ? BLOOM_MOBILE_SCALE : 1);
		if (strength > 0) this.ensureComposer().strength = strength;
		else if (this.bloomPass) this.bloomPass.strength = 0;
	}

	/** Bloom path, built on first use: scene → bloom → output (tone mapping + sRGB). */
	private ensureComposer(): UnrealBloomPass {
		if (this.bloomPass) return this.bloomPass;
		const size = this.renderer.getSize(new THREE.Vector2());
		const ratio = this.renderer.getPixelRatio();
		const target = new THREE.WebGLRenderTarget(size.x * ratio, size.y * ratio, {
			type: THREE.HalfFloatType,
			samples: this.opts.mobile ? 0 : BLOOM_SAMPLES
		});
		const composer = new EffectComposer(this.renderer, target);
		composer.setPixelRatio(ratio);
		composer.setSize(size.x, size.y);
		const bloom = new UnrealBloomPass(size.clone(), 0, BLOOM_RADIUS, BLOOM_THRESHOLD);
		composer.addPass(new RenderPass(this.scene, this.camera));
		composer.addPass(bloom);
		composer.addPass(new OutputPass());
		this.composer = composer;
		this.bloomPass = bloom;
		return bloom;
	}

	private draw(delta: number): void {
		this.renderer.info.reset();
		if (this.composer && this.bloomPass && this.bloomPass.strength > 0) {
			// The camera can be swapped by load(); keep the render pass on the current one.
			(this.composer.passes[0] as RenderPass).camera = this.camera;
			this.composer.render(delta);
		} else {
			this.renderer.render(this.scene, this.camera);
		}
	}

	/** Clouds, blimps, water, people and the robots at motionTime (new robot routes picked in view at the frame). */
	private updateMotion(): void {
		this.sky.update(this.motionTime);
		if (this.water) setWaterTime(this.water, this.motionTime);
		this.people?.update(this.motionTime);
		this.robot?.update(this.motionTime, this.frame);
		const props = this.loadedProps;
		if (this.blimps && props)
			updateBlimps(this.blimps, props.blimps, props.lantern, this.motionTime);
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
		this.envGain = THREE.MathUtils.lerp(1, NIGHT_ENV_GAIN, this.night);
		this.updateEnvIntensity(mixMode(this.night).ambient);
	}

	/** Env strength: mixMode's ambient level (relative to day) times the current bake's gain. */
	private updateEnvIntensity(ambient: number): void {
		this.scene.environmentIntensity = ENV_INTENSITY * ambient * this.envGain;
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

		if (!this.opts.reducedMotion) this.motionTime += delta;
		this.updateMotion();
		this.stepNight(delta);

		this.draw(delta);
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
		if (this.blimps) disposeObject(this.blimps);
		this.people?.dispose();
		this.robot?.dispose();
		if (this.shadowProxy) disposeObject(this.shadowProxy);
		this.uninstallShadowLayer?.();
		this.sky.dispose();
		this.envTarget?.dispose();
		// The light's shadow map render target.
		this.sun.dispose();
		for (const pass of this.composer?.passes ?? []) pass.dispose();
		this.composer?.dispose();
		this.scene.clear();
		this.scene.environment = null;
		this.renderer.dispose();
		// Release the WebGL context now rather than at garbage collection, so repeat visits don't pile them up.
		this.renderer.forceContextLoss();
	}
}

/** The baked walkers from people.glb + people_meta.json, or null (with one warning) when either fails. */
async function loadCast(
	loader: GLTFLoader,
	glbUrl: string,
	metaUrl: string
): Promise<PeopleCast | null> {
	let root: THREE.Object3D | null = null;
	try {
		const [meta, gltf] = await Promise.all([
			fetch(metaUrl).then((res) => {
				if (!res.ok) throw new Error(`${metaUrl}: HTTP ${res.status}`);
				return res.json().then(parsePeopleMeta);
			}),
			loader.loadAsync(glbUrl)
		]);
		root = gltf.scene;
		return castFromScene(root, meta);
	} catch (err) {
		if (root) disposeObject(root);
		console.warn('City hero: no baked people, walking capsules instead.', err);
		return null;
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

/** Every distinct NIGHT_ standard material under `root`, with its night emissive. */
function collectNightMaterials(root: THREE.Object3D): NightMaterial[] {
	const found = new Map<THREE.Material, NightMaterial>();
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh) return;
		for (const m of materialsOf(mesh)) {
			if (found.has(m) || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
			const emissive = nightEmissive(m);
			if (emissive) found.set(m, { material: m as THREE.MeshStandardMaterial, emissive });
		}
	});
	return [...found.values()];
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
