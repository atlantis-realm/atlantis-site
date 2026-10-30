import * as THREE from 'three';
import {
	CityHeroScene,
	type CityHeroMode,
	type CityRig,
	type CityRigPose
} from '#lib/city/CityHeroScene.js';
import { HERO_FRAME_END, HERO_FRAME_START } from '#lib/city/heroCamera.js';
import { WaterWorld } from '#lib/water/WaterWorld.js';

const GLB_URL = '/city/hero.glb';
const PROPS_URL = '/city/hero_props.json';
const WELL_TEXT_NODE = 'Text';

const DEFAULT_WELL_CENTRE = new THREE.Vector3(0, -6.73, 1210);
const DEFAULT_WATER_RADIUS = 16.83;
const DEFAULT_PLAZA_HEIGHT = 8.62;
const OPENING_RADIUS = 3.6;
const RIM_RADIUS = 4.25;
const START_DISTANCE = 15;
const EYE_HEIGHT = 1.83;
const STEP_LENGTH = 0.75;
const STEP_BOB = 0.04;

const FRAME_START_PITCH = THREE.MathUtils.degToRad(2.5);
const FRAME_END_PITCH = THREE.MathUtils.degToRad(-59.6);

const FLOOR_PITCH = THREE.MathUtils.degToRad(-45);
const LANTERN_PITCH = FRAME_START_PITCH;
const UPRIGHT_PITCH = 0;
const PAN_END = 1;
const WALK_END = PAN_END + 1.5;
const FALL_END = WALK_END + 1.25;
const SINK_END = FALL_END + 1.25;
const DIVE_END = SINK_END + 4;
const CONTENT_TIME = SINK_END + 1;
const SCROLL_DAMPING = 6;

const FALL_DRIFT = 0.5;
const SINK_DEPTH = 1.5;
const DIVE_DEPTH = 12;
const DRIFT_BACK = 9;

const WATER_MOODS = { day: 'sunrise', night: 'night' } as const;

export class HomeScene implements CityRig {
	private readonly canvas: HTMLCanvasElement;
	private readonly city: CityHeroScene;
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	private readonly wellCentre = DEFAULT_WELL_CENTRE.clone();
	private plazaHeight = DEFAULT_PLAZA_HEIGHT;
	private readonly waterScene = new THREE.Scene();
	private water: WaterWorld | null = null;
	private camera: THREE.PerspectiveCamera | null = null;
	private mode: CityHeroMode = 'day';
	private elapsed = 0;
	private targetTime = 0;
	private currentTime = 0;
	private destroyed = false;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.city = new CityHeroScene(canvas, {
			reducedMotion: this.reducedMotion,
			mobile: window.matchMedia('(pointer: coarse)').matches,
			rig: this
		});
		this.resize();
	}

	async load(): Promise<void> {
		await this.city.load(GLB_URL, PROPS_URL);
		const props = this.city.props;
		const root = this.city.root;
		if (this.destroyed || !props || !root) return;

		let waterRadius = DEFAULT_WATER_RADIUS;
		const exported = root.getObjectByName(props.well_water);
		if (exported) {
			const box = new THREE.Box3().setFromObject(exported);
			box.getCenter(this.wellCentre);
			waterRadius = (box.max.x - box.min.x) / 2;
			exported.visible = false;
		}
		const text = root.getObjectByName(WELL_TEXT_NODE);
		if (text) text.visible = false;
		this.plazaHeight = this.city.getGround() ?? this.plazaHeight;

		this.water = new WaterWorld(this.waterScene, {
			pool: this.wellCentre,
			poolRadius: OPENING_RADIUS,
			surfaceRadius: waterRadius,
			sky: false,
			startHeight: EYE_HEIGHT,
			descent: DIVE_DEPTH
		});
		this.water.setMood(WATER_MOODS[this.mode], true);
		this.city.addToScene(this.waterScene);
		this.resize();
	}

	warmUp(): Promise<unknown> {
		if (!this.water || !this.camera) return Promise.resolve();
		return this.water.warmUp(this.city.webglRenderer, this.waterScene, this.camera);
	}

	setMode(mode: CityHeroMode): void {
		this.mode = mode;
		this.city.setMode(mode);
		this.water?.setMood(WATER_MOODS[mode], this.reducedMotion);
	}

	setProgress(intro: number, rest: number, immediate = false): void {
		const clamp = THREE.MathUtils.clamp;
		this.targetTime =
			clamp(intro, 0, 1) * CONTENT_TIME + clamp(rest, 0, 1) * (DIVE_END - CONTENT_TIME);
		if (immediate) this.currentTime = this.targetTime;
	}

	pose(camera: THREE.PerspectiveCamera, delta: number): CityRigPose {
		this.currentTime = this.reducedMotion
			? this.targetTime
			: THREE.MathUtils.damp(this.currentTime, this.targetTime, SCROLL_DAMPING, delta);
		if (!this.reducedMotion) this.elapsed += delta;
		this.camera = camera;
		this.updateCamera(camera, this.currentTime);

		const water = this.water;
		if (water) {
			water.stepMood(delta);
			water.update(camera, this.elapsed);
		}
		return { frame: heroFrameFor(camera.rotation.x), city: !water?.submerged };
	}

	render(
		renderer: THREE.WebGLRenderer,
		camera: THREE.PerspectiveCamera,
		drawCity: () => void
	): void {
		if (this.water?.submerged) this.water.render(renderer, this.waterScene, camera);
		else drawCity();
	}

	onResize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
		this.water?.resize(renderer, camera);
	}

	resize(): void {
		const width = this.canvas.clientWidth;
		const height = this.canvas.clientHeight;
		if (width > 0 && height > 0) this.city.resize(width, height);
	}

	private updateCamera(camera: THREE.PerspectiveCamera, time: number): void {
		const clamp = THREE.MathUtils.clamp;
		const pan = THREE.MathUtils.smootherstep(time, 0, PAN_END);
		const walk = THREE.MathUtils.smootherstep(time, PAN_END, WALK_END);
		const fall = clamp((time - WALK_END) / (FALL_END - WALK_END), 0, 1) ** 2;
		const sinkLinear = clamp((time - FALL_END) / (SINK_END - FALL_END), 0, 1);
		const sink = 1 - (1 - sinkLinear) ** 3;
		const rightUp = THREE.MathUtils.smootherstep(time, FALL_END, SINK_END);
		const dive = THREE.MathUtils.smoothstep(time, SINK_END, DIVE_END);
		const driftBack = THREE.MathUtils.smootherstep(time, SINK_END, (SINK_END + DIVE_END) / 2);

		const waterLevel = this.wellCentre.y;
		const walkDistance = START_DISTANCE - RIM_RADIUS;
		const steps = Math.round(walkDistance / STEP_LENGTH);

		const arc = (EYE_HEIGHT * Math.PI) / 2;
		const drop = this.plazaHeight - waterLevel;
		const along = (arc + drop) * fall;
		const lean = Math.min(along / EYE_HEIGHT, Math.PI / 2);
		const dropped = Math.max(along - arc, 0);

		const facePitch = THREE.MathUtils.lerp(FLOOR_PITCH, LANTERN_PITCH, pan) - lean;
		camera.rotation.set(
			facePitch + (UPRIGHT_PITCH - (LANTERN_PITCH - Math.PI / 2)) * rightUp,
			0,
			0
		);
		camera.position.set(
			this.wellCentre.x,
			this.plazaHeight +
				EYE_HEIGHT * Math.cos(lean) -
				STEP_BOB * Math.abs(Math.sin(Math.PI * steps * walk)) -
				dropped -
				SINK_DEPTH * sink -
				(DIVE_DEPTH - SINK_DEPTH) * dive,
			this.wellCentre.z +
				START_DISTANCE -
				walkDistance * walk -
				EYE_HEIGHT * Math.sin(lean) -
				FALL_DRIFT * (dropped / drop) +
				DRIFT_BACK * driftBack
		);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.city.destroy();
		this.water?.dispose();
		this.waterScene.clear();
	}
}

function heroFrameFor(pitch: number): number {
	const u = THREE.MathUtils.clamp(
		(pitch - FRAME_START_PITCH) / (FRAME_END_PITCH - FRAME_START_PITCH),
		0,
		1
	);
	return HERO_FRAME_START + (HERO_FRAME_END - HERO_FRAME_START) * u;
}
