// Day/night mix for the /city hero. t = 0 is day, t = 1 is night; the scene
// cross-fades t and applies mixMode(t) to the sun/moon, ambient, the night-list
// emissives, bloom and exposure. The night list itself is chosen by the export
// (export_hero.py, NIGHT_* materials with extras.night_emissive).

import type * as THREE from 'three';

/** Cross-fade duration between day and night, in seconds. */
export const FADE_S = 1;
/** Material name prefix the export gives every night-list material. */
export const NIGHT_PREFIX = 'NIGHT_';

export type ModeMix = {
	/** Sun (day) / moon (night) light strength. */
	sun: number;
	/** Environment (ambient) strength. */
	ambient: number;
	/** Multiplier on each night material's own emissive strength. */
	emissive: number;
	/** Bloom strength; bloom is off at 0. */
	bloom: number;
	/** Tone-mapping exposure. */
	exposure: number;
};

/**
 * Every night glow (the NIGHT_ materials' emissives: windows, lamps, well ring,
 * Lantern; the robots' and minibots' palette glow, the drones' nav lights and
 * the water's glints of them) is scaled by this at full night. Bloom's
 * threshold is scaled with it (CityHeroScene), so the same lights still bloom,
 * only calmer, and "Welcome to Atlantis" reads clearly at night.
 */
export const NIGHT_GLOW_SCALE = 0.6;

export const DAY_MIX: Readonly<ModeMix> = {
	sun: 3,
	ambient: 1,
	emissive: 0,
	bloom: 0,
	exposure: 1
};
export const NIGHT_MIX: Readonly<ModeMix> = {
	sun: 0.05,
	ambient: 0.15,
	emissive: 1,
	bloom: 0.4,
	exposure: 0.9
};

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
/** a·(1−t) + b·t: exactly a at t = 0 and exactly b at t = 1. */
const lerp = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

/** Light levels at mix t (clamped to 0..1), linear between DAY_MIX and NIGHT_MIX. */
export function mixMode(t: number): ModeMix {
	const u = clamp01(t);
	return {
		sun: lerp(DAY_MIX.sun, NIGHT_MIX.sun, u),
		ambient: lerp(DAY_MIX.ambient, NIGHT_MIX.ambient, u),
		emissive: lerp(DAY_MIX.emissive, NIGHT_MIX.emissive, u),
		bloom: lerp(DAY_MIX.bloom, NIGHT_MIX.bloom, u),
		exposure: lerp(DAY_MIX.exposure, NIGHT_MIX.exposure, u)
	};
}

/**
 * The night emissive [r, g, b, strength] of a night-list material, from its
 * glTF extras (GLTFLoader puts them in userData). Null for any material whose
 * name lacks the NIGHT_ prefix, so stray userData never lights, e.g., a canal.
 */
export function nightEmissive(material: THREE.Material): [number, number, number, number] | null {
	if (!material.name.startsWith(NIGHT_PREFIX)) return null;
	const v: unknown = material.userData?.night_emissive;
	if (!Array.isArray(v) || v.length !== 4) return null;
	if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
	return [v[0], v[1], v[2], v[3]];
}

/** Night glow level at mix t: mixMode(t).emissive times NIGHT_GLOW_SCALE. */
export function nightGlow(t: number): number {
	return mixMode(t).emissive * NIGHT_GLOW_SCALE;
}

/** One cross-fade step: move t toward target by delta / FADE_S, never past it. */
export function fadeToward(t: number, target: number, delta: number): number {
	const step = delta / FADE_S;
	return target > t ? Math.min(target, t + step) : Math.max(target, t - step);
}
