import type { Mesh, MeshPhysicalMaterial } from 'three';
import { getTheme } from '@ladyofcode/dice-themes';
import { createThemeEditState, type ThemeEditState } from '@ladyofcode/dice-engine/themes';
import { resolveNumeralOverrides } from '@ladyofcode/dice-engine/engine/themes.js';
import {
	DICE_SETS,
	applyDiceSet,
	applyDieColors,
	applyNumeralMaps,
	rebuildNumeralAtlases,
	setNumeralUpShift,
	getNumeralUpShift,
	setBevelParams,
	getBevelParams,
	refreshDieGeometry
} from '@ladyofcode/dice-engine/engine/DiceFactory.js';
import {
	emissiveAtlasBackground,
	emissiveAtlasNumeralFill
} from '@ladyofcode/dice-engine/engine/emissiveHalo.js';
import { applyCrystalMaterial, tuning } from '@ladyofcode/dice-engine/engine/tuning.js';
import type { DieSides } from './constants';

type PreviewDie = {
	mesh: Mesh;
	sides: DieSides;
};

function applyMaterialToMesh(mesh: Mesh, diceSet: string): void {
	const t = tuning.material;
	const glass = DICE_SETS[diceSet]?.glass === true;
	const useNumeralDecal = Boolean(t.numeralGradientEnabled && t.numeralRadialInner);
	const numeralOverrides = t.numeralOverrides ?? {};
	const hasOverrides = Object.keys(numeralOverrides).length > 0;
	const material = mesh.material as MeshPhysicalMaterial;
	const faceColor =
		material.map && hasOverrides && !useNumeralDecal ? '#ffffff' : String(t.dieColor);

	applyDieColors(mesh, faceColor, String(t.emissiveColor), { glass });
	applyNumeralMaps(mesh, {
		normalScale: (t.numeralDepth as number | undefined) ?? 1.1,
		relief: (t.numeralRelief as string | undefined) ?? 'engrave'
	});
	applyCrystalMaterial(mesh);
}

export function applyPreviewTheme(
	dice: PreviewDie[],
	themeKey: string,
	{ reloadDiceSet = true }: { reloadDiceSet?: boolean } = {}
): Promise<void> {
	const theme = getTheme(themeKey);
	if (!theme) throw new Error(`Unknown theme: ${themeKey}`);

	const state = createThemeEditState(themeKey);
	const diceSet = theme.diceSet;

	Object.assign(tuning.material, {
		dieColor: state.dieColor,
		emissiveColor: state.emissiveColor,
		transmission: state.transmission,
		thickness: state.thickness,
		emissiveIntensity: state.emissiveIntensity,
		opacity: state.opacity,
		roughness: state.roughness,
		envMapIntensity: state.envMapIntensity,
		clearcoat: state.clearcoat,
		clearcoatRoughness: state.clearcoatRoughness,
		attenuationDistance: state.attenuationDistance,
		numeralColor: state.numeralColor,
		numeralInkColor: state.numeralInkColor,
		numeralRelief: state.numeralRelief ?? 'engrave',
		numeralFont: state.numeralFont ?? 'sans',
		numeralDepth: state.numeralDepth ?? 1.1,
		numeralScale: state.numeralScale ?? 1,
		numeralUpShift: state.numeralUpShift ?? 0,
		numeralGlow: state.numeralGlow,
		bodyHalo: state.bodyHalo ?? 0.12,
		bevel: state.bevel ?? 0,
		bevelSegments: state.bevelSegments ?? 2,
		edgeWearEnabled: state.edgeWearEnabled,
		edgeWear: state.edgeWear,
		edgeWidth: state.edgeWidth,
		edgeStyle: state.edgeStyle ?? 'gradient',
		edgeRoughness: state.edgeRoughness,
		scrapeColor: state.scrapeColor,
		tarnishEnabled: state.tarnishEnabled,
		tarnish: state.tarnish,
		patinaColor: state.patinaColor,
		numeralRadialInner: state.numeralRadialInner ?? null,
		numeralRadialOuter: state.numeralRadialOuter ?? null,
		numeralHaloRadius: state.numeralHaloRadius ?? 0.22,
		numeralGradientEnabled: state.numeralGradientEnabled ?? false,
		numeralOverrides: resolveNumeralOverrides(state)
	});

	Object.assign(tuning.bloom, {
		enabled: state.bloomEnabled,
		strength: state.bloomStrength,
		radius: state.bloomRadius,
		threshold: state.bloomThreshold,
		resScale: state.bloomResScale
	});

	const relief = state.numeralRelief ?? 'engrave';
	const numeralFill =
		relief === 'emboss' ? state.numeralColor : (state.numeralInkColor || state.numeralColor);

	const nextUpShift = state.numeralUpShift ?? 0;
	const upShiftChanged = getNumeralUpShift() !== nextUpShift;
	setNumeralUpShift(nextUpShift);

	const nextBevel = state.bevel ?? 0;
	const nextBevelSegs = state.bevelSegments ?? 2;
	const prevBevel = getBevelParams();
	const bevelChanged =
		Math.abs(prevBevel.amount - nextBevel) > 1e-6 || prevBevel.segments !== nextBevelSegs;
	setBevelParams(nextBevel, nextBevelSegs);

	const numeralGradientOn = state.numeralGradientEnabled !== false && state.numeralRadialInner;
	const decalMode = Boolean(numeralGradientOn);
	const numeralOverrides = resolveNumeralOverrides(state);

	const atlasPromise = rebuildNumeralAtlases({
		fill: numeralFill,
		background: state.dieColor,
		radialInner: decalMode ? state.numeralRadialInner : null,
		radialOuter: null,
		haloRadius: state.numeralHaloRadius ?? 0.22,
		decalMode,
		relief,
		emissiveFill: decalMode
			? (state.numeralColor ?? '#ffffff')
			: emissiveAtlasNumeralFill(state.numeralColor, state.numeralGlow),
		emissiveBackground: emissiveAtlasBackground(state.emissiveColor, state.bodyHalo ?? 0.12),
		emissiveRadialInner: null,
		emissiveRadialOuter: null,
		numeralOverrides,
		numeralScale: state.numeralScale ?? 1,
		numeralFont: state.numeralFont ?? 'sans'
	});

	const refreshMeshes = (): void => {
		for (const { mesh, sides } of dice) {
			if (reloadDiceSet) {
				applyDiceSet(mesh, diceSet);
			}
			if (upShiftChanged || bevelChanged) {
				refreshDieGeometry(mesh, sides);
			}
			applyMaterialToMesh(mesh, diceSet);
		}
	};

	if (atlasPromise != null && typeof (atlasPromise as Promise<unknown>).then === 'function') {
		return (atlasPromise as Promise<unknown>).then(() => {
			refreshMeshes();
		});
	}

	refreshMeshes();
	return Promise.resolve();
}
