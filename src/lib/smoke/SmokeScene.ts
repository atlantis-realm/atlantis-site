import * as THREE from 'three';
import { WaterScene } from '#lib/water/WaterScene.js';

// Experiment: the water world on its own, for working on it outside the homepage.
// See SMOKE_PLAN.md for the stages.
// The camera always looks straight ahead and only sinks: it starts above the pool, the surface
// passes through it, and then the surface's underside recedes overhead.

const WATER_LEVEL = 0;
// The pool sits 7 m in front of the camera, so it's in view from above.
const POOL = new THREE.Vector3(0, WATER_LEVEL, -2);
const CAMERA_Z = 5;
// Scroll-driven descent: from the homepage's eye height (HomeScene EYE_HEIGHT) above the water
// down to this far below it. The surface passes through the camera about 13% of the way down.
const START_HEIGHT = 1.83;
const DESCENT = 12;

export class SmokeScene extends WaterScene {
	constructor(canvas: HTMLCanvasElement) {
		super(canvas, { pool: POOL, startHeight: START_HEIGHT, descent: DESCENT }, 0);
	}

	/** Scroll progress 0..1 over the page's track. */
	setScroll(progress: number): void {
		this.setTarget(THREE.MathUtils.clamp(progress, 0, 1));
	}

	protected placeCamera(progress: number): void {
		// Only the height changes; the camera always looks straight ahead.
		const y = THREE.MathUtils.lerp(WATER_LEVEL + START_HEIGHT, WATER_LEVEL - DESCENT, progress);
		this.camera.position.set(0, y, CAMERA_Z);
		this.camera.lookAt(0, y, POOL.z);
	}
}
