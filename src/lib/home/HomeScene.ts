import * as THREE from 'three';
import { POOL_RADIUS, WaterWorld } from '#lib/water/WaterWorld.js';

// All distances are in metres (1 unit = 1 m). The tower stands at the origin and the
// path runs along the z axis, with the viewer on the +z side looking back at the tower.

// Edge length of each tower cube, bottom to top. Stand-in for the city centre.
const CUBE_SIZES = [600, 400, 250];

// The well sits on the path this far from the tower. The viewer starts on its front edge
// (towards the tower), so it's behind them while they look down, then steps back into its middle.
// The well is the water world's pool (see WaterWorld).
const WELL_DISTANCE = 3000;
const WELL_RADIUS = POOL_RADIUS;
const STEP_BACK = WELL_RADIUS;
const VIEWER_DISTANCE = WELL_DISTANCE - STEP_BACK;
const EYE_HEIGHT = 1.83; // ~6 ft
// Vertical FOV in degrees (three.js FOV is vertical; ~80° horizontal on a 16:9 screen).
const FOV = 50;

// Scroll-driven intro: look down at the floor, pan up to the tower, step back into the well,
// sink below the surface, then dive on down through the water into the dark. Pitch is in radians; 0 is straight ahead with the horizon at eye level.
const FLOOR_PITCH = THREE.MathUtils.degToRad(-45);
const TOWER_PITCH = 0;
const STEP_BOB = 0.04; // slight dip mid-step so it reads as walking, not sliding
// Beat boundaries on the intro timeline; their spacing sets how much scroll each beat takes.
const PAN_END = 1;
const STEP_END = PAN_END + 1;
// Sinking gets a little more scroll than the other beats so it reads as sinking, not dropping.
const SINK_END = STEP_END + 1.5;
// The dive, from just under the surface down into the abyss. The page's content starts scrolling
// up over the water a quarter of the way in, where the light shafts are; the rest of the dive is
// spread over the rest of the page, so the background gets darker all the way to the bottom.
const DIVE_END = SINK_END + 4;
const CONTENT_TIME = SINK_END + 1;
// How quickly the camera catches up to the scroll position (higher is snappier).
const SCROLL_DAMPING = 6;

const WATER_LEVEL = 0.01; // lifted slightly so the surface doesn't z-fight with the path
const SINK_DEPTH = 1.5; // how far below the surface the sink takes the eye
// How far below the surface the dive ends (same as the /smoke experiment), and how far the camera
// drifts back out of the column of light on the way down, so it's seen rather than sat inside.
const DIVE_DEPTH = 12;
const DRIFT_BACK = 7;

const PATH_WIDTH = 40;
const PATH_LENGTH = 10000;
// How far the path extends past the tower towards (and behind) the viewer.
const PATH_BEHIND_TOWER = VIEWER_DISTANCE + 100;

// Placeholder buildings lining both sides of the path, from just behind the viewer towards the tower.
const BUILDINGS_START = VIEWER_DISTANCE + 40;
const BUILDINGS_END = VIEWER_DISTANCE - 1000;
const BUILDING_SETBACK = 6; // gap between the path edge and building fronts
const BUILDING_GAP = 8; // gap between neighbouring buildings
const BUILDING_SEED = 42;

// Small seeded PRNG (mulberry32) so the placeholder layout is the same on every load.
function seededRandom(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export class HomeScene {
	private readonly canvas: HTMLCanvasElement;
	private readonly scene = new THREE.Scene();
	private readonly camera: THREE.PerspectiveCamera;
	private readonly renderer: THREE.WebGLRenderer;
	private readonly cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
	private readonly cubeMaterial = new THREE.MeshStandardMaterial({ color: 0xebd38f });
	private readonly buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xa9b4c2 });
	private readonly path: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
	private readonly water: WaterWorld;
	// Everything above the water (tower, path, buildings), hidden once the camera is under it so
	// none of it shows through the surface.
	private readonly landmarks: THREE.Object3D[] = [];
	private readonly timer = new THREE.Timer();
	// Reduced motion follows the scroll exactly instead of easing after it.
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	private targetTime = 0;
	private currentTime = 0;
	private animationFrameId: number | null = null;
	private destroyed = false;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;

		this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20000);
		this.updateCamera(0);

		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: true,
			// Near/far span kilometres, so a standard depth buffer would z-fight in the distance.
			logarithmicDepthBuffer: true
		});
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.timer.connect(document);

		this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

		const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
		keyLight.position.set(3, 4, 5);
		this.scene.add(keyLight);

		let towerTop = 0;
		for (const size of CUBE_SIZES) {
			const cube = new THREE.Mesh(this.cubeGeometry, this.cubeMaterial);
			cube.scale.setScalar(size);
			cube.position.y = towerTop + size / 2;
			towerTop += size;
			this.scene.add(cube);
			this.landmarks.push(cube);
		}

		this.path = new THREE.Mesh(
			new THREE.PlaneGeometry(PATH_WIDTH, PATH_LENGTH),
			new THREE.MeshStandardMaterial({ color: 0x5a6b7d })
		);
		this.path.rotation.x = -Math.PI / 2;
		this.path.position.z = PATH_BEHIND_TOWER - PATH_LENGTH / 2;
		this.scene.add(this.path);
		this.landmarks.push(this.path);

		this.water = new WaterWorld(this.scene, {
			pool: new THREE.Vector3(0, WATER_LEVEL, WELL_DISTANCE),
			startHeight: EYE_HEIGHT - WATER_LEVEL,
			descent: DIVE_DEPTH
		});

		this.addBuildings();

		this.resize();
		this.start();
	}

	private addBuildings(): void {
		const random = seededRandom(BUILDING_SEED);
		const between = (min: number, max: number) => min + random() * (max - min);

		for (const side of [-1, 1]) {
			let z = BUILDINGS_START;
			while (z > BUILDINGS_END) {
				const width = between(15, 40);
				const depth = between(15, 35);
				const height = between(10, 60);

				const building = new THREE.Mesh(this.cubeGeometry, this.buildingMaterial);
				building.scale.set(depth, height, width);
				building.position.set(
					side * (PATH_WIDTH / 2 + BUILDING_SETBACK + depth / 2),
					height / 2,
					z - width / 2
				);
				this.scene.add(building);
				this.landmarks.push(building);

				z -= width + BUILDING_GAP;
			}
		}
	}

	/**
	 * Scrub the timeline. `intro` runs 0..1 over the intro (looking at the floor, down to where the
	 * content starts); `rest` runs 0..1 over the rest of the page, down to the bottom of the dive.
	 */
	setProgress(intro: number, rest: number): void {
		const clamp = THREE.MathUtils.clamp;
		this.targetTime =
			clamp(intro, 0, 1) * CONTENT_TIME + clamp(rest, 0, 1) * (DIVE_END - CONTENT_TIME);
	}

	private updateCamera(time: number): void {
		const pan = THREE.MathUtils.smootherstep(time, 0, PAN_END);
		const step = THREE.MathUtils.smootherstep(time, PAN_END, STEP_END);
		const sink = THREE.MathUtils.smootherstep(time, STEP_END, SINK_END);
		const dive = THREE.MathUtils.smoothstep(time, SINK_END, DIVE_END);
		const driftBack = THREE.MathUtils.smootherstep(time, SINK_END, (SINK_END + DIVE_END) / 2);

		// Camera looks down -z (towards the tower) by default, so pitch is just rotation.x.
		this.camera.rotation.x = THREE.MathUtils.lerp(FLOOR_PITCH, TOWER_PITCH, pan);
		this.camera.position.set(
			0,
			EYE_HEIGHT -
				STEP_BOB * Math.sin(Math.PI * step) -
				(EYE_HEIGHT - WATER_LEVEL + SINK_DEPTH) * sink -
				(DIVE_DEPTH - SINK_DEPTH) * dive,
			VIEWER_DISTANCE + STEP_BACK * step + DRIFT_BACK * driftBack
		);
	}

	resize(): void {
		const width = this.canvas.clientWidth;
		const height = this.canvas.clientHeight;
		if (width <= 0 || height <= 0) return;

		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height, false);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.water.resize(this.renderer, this.camera);
	}

	private tick = (timestamp: number): void => {
		if (this.destroyed) return;

		this.timer.update(timestamp);
		this.currentTime = this.reducedMotion
			? this.targetTime
			: THREE.MathUtils.damp(
					this.currentTime,
					this.targetTime,
					SCROLL_DAMPING,
					this.timer.getDelta()
				);
		this.updateCamera(this.currentTime);
		this.water.update(this.camera, this.reducedMotion ? 0 : this.timer.getElapsed());
		// The underwater render path has no depth buffer, so the landmarks go as soon as it starts.
		for (const landmark of this.landmarks) landmark.visible = !this.water.submerged;
		this.water.render(this.renderer, this.scene, this.camera);
		this.animationFrameId = requestAnimationFrame(this.tick);
	};

	start(): void {
		if (this.destroyed || this.animationFrameId != null) return;
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
		this.cubeGeometry.dispose();
		this.cubeMaterial.dispose();
		this.buildingMaterial.dispose();
		this.path.geometry.dispose();
		this.path.material.dispose();
		this.water.dispose();
		this.scene.clear();
		this.renderer.dispose();
	}
}
