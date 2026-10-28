// Three.js scene for the /city hero: loads the exported glb, scrubs its baked
// `Hero` camera animation from the scroll position, and draws the procedural
// sky, the day/night cross-fade (night.ts) with bloom, and the circling
// blimps (blimps.ts), the Lantern's heart glowing day and night with the energy spans and runes
// inside it (lanternBeam.ts), the well's water (water.ts), walking, sitting, leaning and talking people
// (people.ts: the baked characters of people.glb, or walking capsules without it) and the
// robots crossing the avenue (robot.ts, robot.glb; none without it), the person-sized
// minibots walking and talking among the people (minibots.ts, the same bake) and the drones
// delivering and picking up parcels (drones.ts, procedural; none without the export's
// drone_spots). Past frame 1 the camera drops to the floor for the section after
// the hero (heroScroll, dropPose). Follows the
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
	EASE_RATE,
	EASE_SNAP_DROP,
	HERO_FRAME_END,
	HERO_FRAME_START,
	dropEase,
	dropGate,
	dropPose,
	easeToward,
	frameToTime,
	safeFrameFov,
	scrollToFrame
} from './heroCamera.ts';
import { loadProps, type HeroProps, type Vec3 } from './props.ts';
import { createSky, setSkyMoon, setSkySun, type Sky } from './sky.ts';
import {
	DAY_MIX,
	NIGHT_GLOW_SCALE,
	fadeToward,
	mixMode,
	nightEmissive,
	nightGlow
} from './night.ts';
import {
	LANTERN_HEART_MATERIAL,
	clipInsideHeart,
	createLanternEnergy,
	findLanternHeart,
	heartGlow,
	prepareHeartMaterial,
	type LanternEnergy
} from './lanternBeam.ts';
import { createBlimps, updateBlimps } from './blimps.ts';
import { applyWater, setWaterLights, setWaterNight, setWaterTime, waterLights } from './water.ts';
import {
	CONVO_GROUPS,
	IDLE_LEANERS,
	IDLE_LEANERS_MOBILE,
	IDLE_SITTERS,
	IDLE_SITTERS_MOBILE,
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
import { createDrones, type DroneState, type Drones } from './drones.ts';
import {
	MINIBOT_TALKERS,
	MINIBOT_WALKERS,
	MINIBOT_WALKERS_MOBILE,
	canMakeMinibots,
	createMinibots,
	type MinibotState,
	type Minibots
} from './minibots.ts';

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
 * keeps whole texels above the threshold (linear, before exposure). Unscaled, 2.0
 * sits above the windows (~1.6) and bands (~1.4) and below the lamps (~2.6) and
 * the Lantern / well ring cyan (~3.1); every night glow is scaled by
 * NIGHT_GLOW_SCALE, so the threshold is too and the same lights bloom, only
 * calmer: bloom stays mild instead of hazing every facade.
 * Radius 0 weights the small mips, so the well ring at frame 250 (most of the
 * screen) glows without washing out "Welcome to Atlantis".
 */
const BLOOM_RADIUS = 0;
const BLOOM_THRESHOLD = 2.0 * NIGHT_GLOW_SCALE;
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
	/** The camera's world position, for the robots' route weights. */
	private readonly eye = new THREE.Vector3();
	private nightMaterials: NightMaterial[] = [];
	/** The energy spans and runes inside the Lantern's heart (lanternBeam.ts); null without a heart. */
	private lanternEnergy: LanternEnergy | null = null;
	private composer: EffectComposer | null = null;
	private bloomPass: UnrealBloomPass | null = null;
	private blimps: THREE.InstancedMesh | null = null;
	private people: People | null = null;
	private robot: Robots | null = null;
	private drones: Drones | null = null;
	private minibots: Minibots | null = null;
	/** The camera's view, for the drones' unseen entry and exit points. */
	private readonly frustum = new THREE.Frustum();
	private readonly viewProjection = new THREE.Matrix4();
	private readonly probe = new THREE.Vector3();
	private readonly inView = (p: Vec3): boolean =>
		this.frustum.containsPoint(this.probe.set(p[0], p[1], p[2]));
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
	/** Floor drop after frame 1 (heroScroll): 0 on the frame-1 pose, 1 with the eye on the floor. */
	private drop = 0;
	private targetDrop = 0;
	/** Floor height under the frame-1 camera (found by groundUnderEnd()); null keeps the eye height. */
	private groundY: number | null = null;
	/** The render loop is stopped while the page covers the canvas (setPaused). */
	private paused = false;
	/**
	 * The camera's pose as the mixer last set it. The mixer only writes a track
	 * when its value changes, so setFrameTime() puts this back before the
	 * opening tilt and the drop are applied again, and they never accumulate.
	 */
	private readonly animPos = new THREE.Vector3();
	private readonly animQuat = new THREE.Quaternion();
	private animSaved = false;
	private readonly dropPos = new THREE.Vector3();
	private readonly dropQuat = new THREE.Quaternion();
	private readonly dropEuler = new THREE.Euler(0, 0, 0, 'YXZ');
	private readonly dropMatrix = new THREE.Matrix4();
	private readonly parentInverse = new THREE.Matrix4();
	private readonly dropScale = new THREE.Vector3();
	/** Clock of the moving things (clouds, blimps, water, people, minibots, robot, drones); frozen with reducedMotion. */
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
		if (this.water) {
			// The glints are reflections of the night glows, so they calm down with them.
			const lights = waterLights(gltf.scene, this.plaza.toArray()).map((l) => ({
				...l,
				color: l.color.map((c) => c * NIGHT_GLOW_SCALE) as Vec3
			}));
			setWaterLights(this.water, lights);
		}
		this.setupLantern(gltf.scene, props);

		this.sunDir.set(...props.sun.dir).normalize();
		setSkySun(this.sky, this.sunDir);
		this.groundY = this.groundUnderEnd(gltf.scene);
		this.setFrameTime(this.frame);
		this.sky.uniforms.uCityDir.value.copy(this.cityDirection(props));
		setSkyMoon(this.sky, this.sky.uniforms.uCityDir.value);
		this.setupShadows();
		this.blimps = createBlimps(props.blimps);
		this.scene.add(this.blimps);
		const peopleOpts = {
			perPath: this.opts.mobile ? PEOPLE_PER_PATH_MOBILE : PEOPLE_PER_PATH,
			speed: WALK_SPEED,
			// Sitting and leaning at the export's idle spots, talking at its talk spots; the capsules
			// leave them out.
			idle: this.opts.mobile
				? { sit: IDLE_SITTERS_MOBILE, lean: IDLE_LEANERS_MOBILE }
				: { sit: IDLE_SITTERS, lean: IDLE_LEANERS },
			idleSpots: props.idle_spots,
			convos: CONVO_GROUPS,
			talkSpots: props.talk_spots,
			// Conversation places for the minibots, only when robot.glb has their simplified meshes and clips.
			botSlots:
				robot && canMakeMinibots(robot.scene, robot.animations, robot.meta) ? MINIBOT_TALKERS : 0
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
			// The minibots bake what they need from the robot scene, so they go first.
			this.minibots = createMinibots(
				robot.scene,
				robot.animations,
				robot.meta,
				props.walk_paths,
				this.people.slots ?? [],
				{
					shadows: !this.opts.mobile,
					walkers: this.opts.mobile ? MINIBOT_WALKERS_MOBILE : MINIBOT_WALKERS,
					people: this.people.walkers
				}
			);
			if (this.minibots) this.scene.add(this.minibots.mesh);
			this.robot = createRobots(robot.scene, robot.animations, robot.meta, props.robot_routes, {
				shadows: !this.opts.mobile
			});
			if (this.robot) this.scene.add(this.robot.object);
			else disposeObject(robot.scene);
		}
		this.drones = createDrones(props.drone_spots, props.drone_sky, { shadows: !this.opts.mobile });
		if (this.drones) this.scene.add(this.drones.object);
		this.updateMotion();
		this.applyMix();
		this.bakeEnvironment();
		this.resize(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);
	}

	/** Scroll progress 0..1 → frame target (250..1), and the floor drop 0..1 after it (heroScroll). */
	setScroll(progress: number, drop = 0): void {
		this.targetFrame = scrollToFrame(progress);
		this.targetDrop = THREE.MathUtils.clamp(drop, 0, 1);
	}

	/**
	 * Stop the render loop while nothing of the canvas shows (the section after
	 * the hero covers the viewport), and pick it up again where it was.
	 */
	setPaused(paused: boolean): void {
		if (paused === this.paused || this.destroyed) return;
		this.paused = paused;
		if (paused) {
			if (this.animationFrameId != null) cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		} else {
			// No catch-up: the paused time doesn't reach the easing or motionTime.
			// The scroll, mode and size may all have changed while covered (or the
			// page loaded already covered), so the revealed strip shows the current
			// pose and mode at once, drawn now rather than on the next frame.
			this.frame = this.targetFrame;
			this.drop = this.targetDrop * dropGate(this.frame);
			this.setFrameTime(this.frame);
			this.updateProjection();
			this.stepNight(Infinity);
			this.updateMotion();
			this.draw(0);
			this.timer.reset();
			this.start();
		}
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

	/** Each minibot's kind (walk / talk), variant, palette, height and position (none before load or without robot.glb). */
	minibotState(): MinibotState[] {
		return this.minibots?.state() ?? [];
	}

	/** Where each drone is: its trip kind, drop spot, take-off spot (-1: flew in), livery, position and whether its parcel is on the spot. */
	droneState(): DroneState[] {
		return this.drones?.state() ?? [];
	}

	/** Current (eased) Blender frame. */
	getFrame(): number {
		return this.frame;
	}

	/** Current (eased) floor drop, 0..1. */
	getDrop(): number {
		return this.drop;
	}

	/** Floor height under the frame-1 camera, null when nothing was found below it. */
	getGround(): number | null {
		return this.groundY;
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
		if (this.animSaved) {
			this.camera.position.copy(this.animPos);
			this.camera.quaternion.copy(this.animQuat);
		}
		this.action.time = t;
		this.mixer.update(0);
		this.animPos.copy(this.camera.position);
		this.animQuat.copy(this.camera.quaternion);
		this.animSaved = true;
		// The camera now holds the mixer's pose (animPos), so the tilt never accumulates.
		const aim = THREE.MathUtils.smoothstep(
			frame,
			HERO_FRAME_END - OPENING_AIM_FADE_FRAMES,
			HERO_FRAME_END
		);
		if (aim > 0) this.camera.rotateX(THREE.MathUtils.degToRad(OPENING_PITCH_DEG * aim));
		if (this.drop > 0) this.applyDrop();
	}

	/**
	 * The floor drop on top of the frame's pose (frame 1 once the hero has
	 * settled): straight down to groundY, keeping the heading while the pitch
	 * and roll ease to level, so the horizon ends at the middle of the screen.
	 * Worked in world space, then put back under the camera's parent.
	 */
	private applyDrop(): void {
		const cam = this.camera;
		cam.updateMatrixWorld();
		cam.matrixWorld.decompose(this.dropPos, this.dropQuat, this.dropScale);
		this.dropEuler.setFromQuaternion(this.dropQuat, 'YXZ');
		const pose = dropPose(
			this.dropPos.y,
			this.groundY ?? this.dropPos.y,
			this.dropEuler.x,
			this.drop
		);
		this.dropPos.y = pose.y;
		this.dropEuler.x = pose.pitch;
		this.dropEuler.z *= 1 - dropEase(this.drop);
		this.dropQuat.setFromEuler(this.dropEuler);
		this.dropMatrix.compose(this.dropPos, this.dropQuat, this.dropScale);
		if (cam.parent) {
			this.dropMatrix.premultiply(this.parentInverse.copy(cam.parent.matrixWorld).invert());
		}
		this.dropMatrix.decompose(cam.position, cam.quaternion, cam.scale);
		cam.updateMatrixWorld();
	}

	/**
	 * The floor under the camera at frame 1 (the end of the hero move): the first
	 * surface straight below it in the glb. Null, with a warning, when there is none.
	 */
	private groundUnderEnd(root: THREE.Object3D): number | null {
		this.setFrameTime(HERO_FRAME_START);
		root.updateMatrixWorld(true);
		const from = this.camera.getWorldPosition(new THREE.Vector3());
		const ray = new THREE.Raycaster(from, new THREE.Vector3(0, -1, 0));
		const hit = ray.intersectObject(root, true).find((h) => (h.object as THREE.Mesh).isMesh);
		if (!hit)
			console.warn('City hero: no floor under the frame-1 camera; the drop only levels it.');
		return hit ? hit.point.y : null;
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

	/**
	 * The Lantern's heart: a glowing glass tube (prepareHeartMaterial) with the
	 * stone shaft cut away inside it (clipInsideHeart) and the energy spans and
	 * runes drawn in it, after it.
	 */
	private setupLantern(root: THREE.Object3D, props: HeroProps): void {
		const found = findLanternHeart(root, props.night_nodes);
		if (!found) return;
		for (const mesh of found.heart) {
			for (const m of materialsOf(mesh))
				if (m.name === LANTERN_HEART_MATERIAL) prepareHeartMaterial(m);
		}
		clipInsideHeart(found.others, found.bounds);
		this.lanternEnergy = createLanternEnergy(found.bounds);
		this.scene.add(this.lanternEnergy.object);
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
		const glow = nightGlow(t);
		for (const { material, emissive } of this.nightMaterials) {
			material.emissive.setRGB(emissive[0], emissive[1], emissive[2]);
			// The Lantern's heart glows by day too.
			material.emissiveIntensity =
				material.name === LANTERN_HEART_MATERIAL
					? heartGlow(t)
					: emissive[3] * nightGlow(t, material.name);
		}
		this.lanternEnergy?.setNight(t);
		this.sky.setMix(t);
		this.renderer.toneMappingExposure = mix.exposure;
		if (this.water) setWaterNight(this.water, mix.emissive);
		this.robot?.setNight(glow);
		this.minibots?.setNight(glow);
		this.drones?.setNight(glow);

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

	/**
	 * Clouds, blimps, the Lantern's energy, water, people, minibots, the robots and the drones at motionTime (new
	 * robot routes and drop spots picked in view at the frame, the near ones most).
	 */
	private updateMotion(): void {
		this.sky.update(this.motionTime);
		if (this.water) setWaterTime(this.water, this.motionTime);
		this.people?.update(this.motionTime);
		this.minibots?.update(this.motionTime);
		this.lanternEnergy?.update(this.motionTime);
		const eye = this.camera.getWorldPosition(this.eye);
		if (this.robot) this.robot.update(this.motionTime, this.frame, [eye.x, eye.y, eye.z]);
		if (this.drones) {
			this.camera.updateMatrixWorld();
			this.frustum.setFromProjectionMatrix(
				this.viewProjection.multiplyMatrices(
					this.camera.projectionMatrix,
					this.camera.matrixWorldInverse
				)
			);
			this.drones.update(this.motionTime, this.frame, [eye.x, eye.y, eye.z], this.inView);
		}
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
		const prevDrop = this.drop;
		this.frame = this.opts.reducedMotion
			? this.targetFrame
			: easeToward(this.frame, this.targetFrame, delta);
		// The drop waits for the hero move to land on frame 1 (dropGate).
		const dropTarget = this.targetDrop * dropGate(this.frame);
		this.drop = this.opts.reducedMotion
			? dropTarget
			: easeToward(this.drop, dropTarget, delta, EASE_RATE, EASE_SNAP_DROP);
		if (this.frame !== prev || this.drop !== prevDrop) {
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
		if (this.animationFrameId != null || this.paused) return;
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
		this.minibots?.dispose();
		this.drones?.dispose();
		this.lanternEnergy?.dispose();
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
