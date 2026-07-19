import { getTheme, listThemesByAccess } from '@ladyofcode/dice-themes';

export type ThemeTier = 'public' | 'subscriber';

export type CatalogTheme = {
	id: string;
	label: string;
	tier: ThemeTier;
	description?: string;
};

const THEME_DESCRIPTIONS: Record<string, string> = {
	ivory: 'We all have a bone to pick.',
	bg3: "Baldur's Gate 3, thank you for the inspo.",
	zuko: "I don't need luck, though. I don't want it. I've had to struggle and fight and that's made me strong. It's made me who I am.",
	'24k': 'Subscriber-only gold dice with a warm glow.'
};

function toCatalogTheme(entry: { id: string; label: string; access?: string }): CatalogTheme {
	return {
		id: entry.id,
		label: entry.label,
		tier: entry.access === 'subscriber' ? 'subscriber' : 'public',
		description: THEME_DESCRIPTIONS[entry.id]
	};
}

const grouped = listThemesByAccess();

export const PUBLIC_THEMES: CatalogTheme[] = (grouped.everyone ?? []).map(toCatalogTheme);
export const SUBSCRIBER_THEMES: CatalogTheme[] = (grouped.subscriber ?? []).map(toCatalogTheme);

export function themeChatCommand(entry: CatalogTheme): string {
	return `!dicethemes ${entry.id}`;
}

export function resolveCatalogTheme(entry: CatalogTheme): CatalogTheme & {
	available: boolean;
	dieColor: string;
	emissiveColor: string;
} {
	const theme = getTheme(entry.id);
	const dieColor = theme?.defaults.dieColor ?? '#888888';
	const emissiveColor = theme?.defaults.emissiveColor ?? '#cccccc';

	return {
		...entry,
		label: entry.label ?? theme?.label ?? entry.id,
		available: theme != null,
		dieColor,
		emissiveColor
	};
}

export function allCatalogThemes(): CatalogTheme[] {
	return [...PUBLIC_THEMES, ...SUBSCRIBER_THEMES];
}
