import * as THREE from 'three';
import { WaterWorld, type WaterWorldOptions } from '#lib/water/WaterWorld.js';

// Soft water and sky, nothing that needs to be crisp: render at a lower pixel density than the
// screen's, which is cheaper per frame and gives a much smaller offscreen target.
const MAX_PIXEL_RATIO = 1.5;
const TOUCH_PIXEL_RATIO = 1;
// How quickly the camera catches up to the scroll position (higher is snappier).
const SCROLL_DAMPING = 6;

/**
 * The shared frame loop for the scroll-driven water scenes (/smoke and the ocean background). The
 * scroll sets a target value, the value eases towards it each frame, and the subclass places the
 * camera from it.
 */
export abstract class WaterScene {
	protected readonly scene = new THREE.Scene();
	// Far enough to draw the water out to the horizon; there's no depth buffer, so it costs nothing.
	protected readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
	private readonly renderer: THREE.WebGLRenderer;
	private readonly timer = new THREE.Timer();
	private readonly water: WaterWorld;
	private value: number;
	private target: number;
	// Reduced motion holds the water still and follows the scroll exactly.
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	constructor(canvas: HTMLCanvasElement, options: WaterWorldOptions, initial: number) {
		// No antialiasing or depth buffer on the canvas: underwater only the full-screen composite is
		// drawn to it, and above the water only the sky and the water, which don't overlap.
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, depth: false });
		const touch = window.matchMedia('(pointer: coarse)').matches;
		this.renderer.setPixelRatio(
			Math.min(window.devicePixelRatio, touch ? TOUCH_PIXEL_RATIO : MAX_PIXEL_RATIO)
		);
		this.water = new WaterWorld(this.scene, options);
		this.value = this.target = initial;
		this.placeCamera(initial);
		this.setActive(true);
	}

	/** Position the camera for a (damped) value. Only module constants are safe to use here. */
	protected abstract placeCamera(value: number): void;

	protected setTarget(value: number): void {
		this.target = value;
	}

	/** Start or stop rendering, e.g. while the scene is scrolled out of view. */
	setActive(active: boolean): void {
		this.renderer.setAnimationLoop(active ? (time) => this.frame(time) : null);
	}

	private frame(time: number): void {
		this.timer.update(time);
		this.value = this.reducedMotion
			? this.target
			: THREE.MathUtils.damp(this.value, this.target, SCROLL_DAMPING, this.timer.getDelta());
		this.placeCamera(this.value);
		this.water.update(this.camera, this.reducedMotion ? 0 : this.timer.getElapsed());
		this.water.render(this.renderer, this.scene, this.camera);
	}

	resize(width: number, height: number): void {
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.water.resize(this.renderer, this.camera);
	}

	destroy(): void {
		this.renderer.setAnimationLoop(null);
		this.water.dispose();
		this.renderer.dispose();
	}
}
