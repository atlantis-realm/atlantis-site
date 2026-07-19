declare module '@ladyofcode/dice-engine/themes' {
	export type ThemeEditState = {
		dieColor: string;
		emissiveColor: string;
		transmission: number;
		thickness: number;
		emissiveIntensity: number;
		opacity: number;
		roughness: number;
		envMapIntensity: number;
		clearcoat: number;
		clearcoatRoughness: number;
		attenuationDistance: number;
		numeralColor: string;
		numeralInkColor: string;
		numeralRelief?: 'engrave' | 'emboss';
		numeralFont?: string;
		numeralDepth?: number;
		numeralScale?: number;
		numeralUpShift?: number;
		numeralGlow: number;
		bodyHalo?: number;
		bevel?: number;
		bevelSegments?: number;
		edgeWearEnabled: boolean;
		edgeWear: number;
		edgeWidth: number;
		edgeStyle?: string;
		edgeRoughness: number;
		scrapeColor: string;
		tarnishEnabled: boolean;
		tarnish: number;
		patinaColor: string;
		numeralRadialInner?: string | null;
		numeralRadialOuter?: string | null;
		numeralHaloRadius?: number;
		numeralGradientEnabled?: boolean;
		numeralFaceOverrides?: unknown[];
		numeralOverrides?: Record<string, unknown>;
		bloomEnabled?: boolean;
		bloomStrength?: number;
		bloomRadius?: number;
		bloomThreshold?: number;
		bloomResScale?: number;
	};

	export function createThemeEditState(themeKey: string): ThemeEditState;
}

declare module '@ladyofcode/dice-engine/engine/themes.js' {
	import type { ThemeEditState } from '@ladyofcode/dice-engine/themes';

	export function resolveNumeralOverrides(
		state: ThemeEditState
	): Record<string, unknown>;
}

declare module '@ladyofcode/dice-engine/environments/brown_photostudio.hdr?url' {
	const url: string;
	export default url;
}

declare module '@ladyofcode/dice-themes' {
	export const ACCESS_EVERYONE: 'everyone';
	export const ACCESS_SUBSCRIBER: 'subscriber';
	export const ACCESS_VALUES: Set<string>;
	export const DEFAULT_THEME: string;

	export type ThemeDefaults = {
		dieColor: string;
		emissiveColor: string;
		transmission: number;
		thickness: number;
		emissiveIntensity: number;
		opacity: number;
		roughness: number;
		envMapIntensity: number;
		clearcoat: number;
		clearcoatRoughness: number;
		attenuationDistance: number;
		numeralColor: string;
		numeralInkColor: string;
		numeralRelief?: 'engrave' | 'emboss';
		numeralDepth?: number;
		numeralGlow: number;
		bodyHalo?: number;
		edgeWearEnabled: boolean;
		edgeWear: number;
		edgeWidth: number;
		edgeRoughness: number;
		scrapeColor: string;
		tarnishEnabled: boolean;
		tarnish: number;
		patinaColor: string;
	};

	export type ThemeDefinition = {
		label: string;
		access?: string;
		diceSet: string;
		defaults: ThemeDefaults;
	};

	export type ThemeListEntry = {
		id: string;
		label: string;
		access?: string;
	};

	export function getTheme(key: string): ThemeDefinition | null;
	export function listThemes(): ThemeListEntry[];
	export function isValidThemeId(id: string): boolean;
	export function getThemeAccess(id: string): string | null;
	export function canAccessTheme(
		id: string,
		opts?: { subscriber?: boolean }
	): boolean;
	export function listThemesByAccess(): Record<string, ThemeListEntry[]>;
}

declare module '@ladyofcode/dice-engine/engine/DiceFactory.js' {
	import type { Mesh } from 'three';

	export const DICE_SETS: Record<string, { glass?: boolean }>;

	export function createDie(sides: number, setKey?: string): Mesh;
	export function disposeCache(): void;
	export function applyDiceSet(mesh: Mesh, setKey: string): void;
	export function applyDieColors(
		mesh: Mesh,
		dieColor: string,
		emissiveColor: string,
		opts?: { glass?: boolean }
	): void;
	export function applyNumeralMaps(
		mesh: Mesh,
		opts?: { normalScale?: number; relief?: string }
	): void;
	export function setNumeralUpShift(value: number): void;
	export function getNumeralUpShift(): number;
	export function setBevelParams(amount: number, segments: number): void;
	export function getBevelParams(): { amount: number; segments: number };
	export function refreshDieGeometry(mesh: Mesh, sides: number): void;
	export function rebuildNumeralAtlases(opts?: {
		fill?: string;
		background?: string;
		emissiveFill?: string;
		emissiveBackground?: string;
		radialInner?: string | null;
		radialOuter?: string | null;
		emissiveRadialInner?: string | null;
		emissiveRadialOuter?: string | null;
		haloRadius?: number;
		decalMode?: boolean;
		numeralOverrides?: Record<string, unknown>;
		numeralScale?: number;
		numeralFont?: string;
		relief?: string;
	}): void | Promise<unknown>;
}

declare module '@ladyofcode/dice-engine/engine/emissiveHalo.js' {
	export function emissiveAtlasBackground(emissiveColor: string, bodyHalo?: number): string;
	export function emissiveAtlasNumeralFill(numeralColor: string, numeralGlow?: number): string;
}

declare module '@ladyofcode/dice-engine/engine/tuning.js' {
	import type { Mesh } from 'three';

	export const tuning: {
		material: Record<string, unknown>;
		bloom: Record<string, unknown>;
	};

	export function applyCrystalMaterial(mesh: Mesh): void;
}

declare module '@ladyofcode/dice-engine/engine/effects/BloomPipeline.js' {
	import type { Camera, Scene, WebGLRenderer } from 'three';

	export class BloomPipeline {
		constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera);
		applyFromTuning(): void;
		setSize(width: number, height: number): void;
		render(delta?: number): void;
		dispose(): void;
	}
}

declare module '@ladyofcode/dice-engine/engine/EnvironmentMap.js' {
	import type { Scene, WebGLRenderer } from 'three';

	export class EnvironmentMap {
		constructor(renderer: WebGLRenderer, opts?: { hdrUrl?: string | null });
		init(scene: Scene): unknown;
		dispose(): void;
	}
}
