export const DICE_TYPES = [4, 6, 8, 20, 10, 12] as const;

export type DieSides = (typeof DICE_TYPES)[number];

export const DEFAULT_DIE_INDEX = DICE_TYPES.indexOf(20);

const SPACING = 2.4;

function offsetFromDefault(index: number): number {
	return (index - DEFAULT_DIE_INDEX) * SPACING;
}

export const DICE_ROW_CENTER_X =
	(offsetFromDefault(0) + offsetFromDefault(DICE_TYPES.length - 1)) / 2;

export function dieRowOffset(index: number): number {
	return offsetFromDefault(index) - DICE_ROW_CENTER_X;
}

export type DiceLayoutMode = 'desktop' | 'tablet' | 'mobile';

export function dieLabel(sides: DieSides): string {
	return `d${sides}`;
}
