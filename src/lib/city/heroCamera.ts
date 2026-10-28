// Camera maths for the /city hero: scroll → Blender frame → glb animation time,
// the floor drop into the section after the hero, the safe-frame field of view,
// and frame easing. Pure functions, unit-tested with `node --test` (see
// heroCamera.test.ts).

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
/** The same for the floor drop (0..1): a hundredth of a millimetre on a 1.7 m drop. */
export const EASE_SNAP_DROP = 1e-5;

const DEG = Math.PI / 180;

/**
 * The narrowest screen aspect the export culls for (9:19.5, a tall phone in
 * portrait; MIN_ASPECT in hero_geom.py). Narrower screens use its FOV: they see
 * a little less of the safe frame's width, but never past the culled geometry.
 */
export const MIN_ASPECT = 9 / 19.5;

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
 * the vertical FOV; 16:9 and wider keep `baseVFovDeg`. Aspects narrower than
 * MIN_ASPECT are treated as MIN_ASPECT.
 *
 * Same rule as `safe_vfov` in concept-assets/city/generators/hero_geom.py
 * (the export culls against it); keep the two formulas identical.
 */
export function safeFrameFov(aspect: number, baseVFovDeg: number, safeHalfTan: number): number {
	const neededDeg = (2 * Math.atan(safeHalfTan / Math.max(aspect, MIN_ASPECT))) / DEG;
	return Math.max(baseVFovDeg, neededDeg);
}

/**
 * Exponential approach of `current` toward `target` over `dt` seconds. Never
 * overshoots, and snaps onto the target once within `snap` (EASE_SNAP_FRAMES by
 * default), so a given scroll position always settles on exactly its frame.
 */
export function easeToward(
	current: number,
	target: number,
	dt: number,
	rate = EASE_RATE,
	snap = EASE_SNAP_FRAMES
): number {
	const next = target + (current - target) * Math.exp(-rate * dt);
	return Math.abs(next - target) < snap ? target : next;
}

/**
 * Where the hero is for a page scroll position. The hero move (frames 250→1)
 * plays while the track scrolls past, until the section after it (`sectionTop`,
 * its top edge in page coordinates) enters the bottom of the viewport. Then the
 * floor drop runs: `drop` goes 0→1 as that edge rises to the middle of the
 * viewport, where a levelled camera's horizon sits, so the edge reads as the
 * floor surface rising to eye level. Both clamp to [0,1].
 */
export function heroScroll(
	scrollY: number,
	sectionTop: number,
	viewportH: number
): { progress: number; drop: number } {
	const heroRange = sectionTop - viewportH;
	const progress = heroRange > 0 ? Math.min(1, Math.max(0, scrollY / heroRange)) : 1;
	const dropRange = viewportH / 2;
	const drop = dropRange > 0 ? Math.min(1, Math.max(0, (scrollY - heroRange) / dropRange)) : 0;
	return { progress, drop };
}

/**
 * Drop progress → how far along the camera is (0 at the frame-1 pose, 1 with
 * the eye on the floor and the view level). Smoothstep, so it leaves the hero
 * move and settles on the floor gently.
 */
export function dropEase(drop: number): number {
	const d = Math.min(1, Math.max(0, drop));
	return d * d * (3 - 2 * d);
}

/**
 * Eye height and pitch (radians) during the drop: straight down from `eyeY` to
 * `groundY` while the pitch eases to level. Never below the ground.
 */
export function dropPose(
	eyeY: number,
	groundY: number,
	pitch: number,
	drop: number
): { y: number; pitch: number } {
	const t = dropEase(drop);
	return { y: Math.max(groundY, eyeY + (groundY - eyeY) * t), pitch: pitch * (1 - t) };
}

/** True when a box from `top` to `bottom` (viewport px) hides the whole viewport. */
export function coversViewport(top: number, bottom: number, viewportH: number): boolean {
	return top <= 0 && bottom >= viewportH;
}
