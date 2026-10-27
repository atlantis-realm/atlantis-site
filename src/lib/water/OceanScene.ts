import * as THREE from 'three';
import { WaterScene } from '#lib/water/WaterScene.js';

// The background for the site's other pages: open water under the daytime sky. Like /smoke, the
// camera looks straight ahead and only sinks: it starts at eye height above the water, goes
// through the surface over the first stretch of scroll (with the plunge's bubble burst), then dives
// down through the rest of the page, getting darker towards the bottom.

const WATER_LEVEL = 0;
// The homepage's eye height (HomeScene EYE_HEIGHT).
const START_HEIGHT = 1.83;
// Where the crossing leaves the camera, just under the surface.
const UNDER_DEPTH = 0.6;
// How far below the surface the bottom of the page reaches (the abyss, like the homepage).
const DESCENT = 12;
// Light shafts hang from a spot this far ahead, so they're in view rather than around the camera.
const LIGHT_AHEAD = 9;

export class OceanScene extends WaterScene {
	constructor(canvas: HTMLCanvasElement) {
		super(
			canvas,
			{
				pool: new THREE.Vector3(0, WATER_LEVEL, -LIGHT_AHEAD),
				startHeight: START_HEIGHT,
				descent: DESCENT,
				openWater: true
			},
			START_HEIGHT
		);
	}

	/**
	 * `cross` runs 0..1 over the scroll that takes the camera through the surface; `dive` runs 0..1
	 * over the rest of the page.
	 */
	setScroll(cross: number, dive: number): void {
		const clamp = THREE.MathUtils.clamp;
		this.setTarget(
			THREE.MathUtils.lerp(START_HEIGHT, -UNDER_DEPTH, clamp(cross, 0, 1)) -
				clamp(dive, 0, 1) * (DESCENT - UNDER_DEPTH)
		);
	}

	protected placeCamera(height: number): void {
		this.camera.position.set(0, WATER_LEVEL + height, 0);
		this.camera.lookAt(0, WATER_LEVEL + height, -1);
	}
}
