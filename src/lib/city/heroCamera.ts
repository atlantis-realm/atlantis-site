// Camera maths for the /city hero: scroll → Blender frame → glb animation time,
// the safe-frame field of view, and frame easing. Pure functions, unit-tested
// with `node --test` (see heroCamera.test.ts).

/** First frame of the Blender hero move (`Camera.001`, the avenue view). */
export const HERO_FRAME_START = 1;
/** Last frame of the hero move (looking down the well at "Welcome to Atlantis"). */
export const HERO_FRAME_END = 250;
/** Blender scene frame rate; the glb animation is baked at this rate. */
export const HERO_FPS = 24;
/** Default easing rate (1/s) for the camera chasing its scroll target. */
export const EASE_RATE = 8;
/** Distance (in frames) under which easing snaps onto the target. */
export const EASE_SNAP_FRAMES = 1e-3;

const DEG = Math.PI / 180;

/**
 * Scroll progress 0→1 maps to frames 250→1: the page opens on the well and
 * scrolling down plays the hero move in reverse. Progress is clamped to [0,1].
 */
export function scrollToFrame(
	progress: number,
	start = HERO_FRAME_START,
	end = HERO_FRAME_END
): number {
	const p = Math.min(1, Math.max(0, progress));
	return end + (start - end) * p;
}

/** Seconds into the glb camera animation for a Blender frame. */
export function frameToTime(frame: number, fps = HERO_FPS, start = HERO_FRAME_START): number {
	return (frame - start) / fps;
}

/**
 * Vertical FOV (degrees) that keeps the safe frame's width in view.
 *
 * `baseVFovDeg` is the Blender camera's vertical FOV at 16:9; `safeHalfTan` is
 * tan of half the horizontal angle that must stay visible. Narrow screens widen
 * the vertical FOV; 16:9 and wider keep `baseVFovDeg`.
 *
 * Same rule as `safe_vfov` in concept-assets/city/generators/hero_geom.py
 * (the export culls against it); keep the two formulas identical.
 */
export function safeFrameFov(aspect: number, baseVFovDeg: number, safeHalfTan: number): number {
	const neededDeg = (2 * Math.atan(safeHalfTan / aspect)) / DEG;
	return Math.max(baseVFovDeg, neededDeg);
}

/**
 * Exponential approach of `current` toward `target` over `dt` seconds. Never
 * overshoots, and snaps onto the target once within EASE_SNAP_FRAMES, so a
 * given scroll position always settles on exactly its frame.
 */
export function easeToward(current: number, target: number, dt: number, rate = EASE_RATE): number {
	const next = target + (current - target) * Math.exp(-rate * dt);
	return Math.abs(next - target) < EASE_SNAP_FRAMES ? target : next;
}
