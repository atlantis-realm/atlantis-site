// Every look the water can take; each page picks one, and the ocean background blends between them
// as you move from page to page.
export const MOODS = ['sunrise', 'morning', 'twilight', 'night', 'rain'] as const;

/** Which look a page's water is drawn in (palettes and weather in WaterWorld). */
export type Mood = (typeof MOODS)[number];

// Pages (and everything under them) with a mood of their own; the rest are at sunrise.
const PAGE_MOODS: [string, Mood][] = [
	['/about', 'morning'],
	['/events', 'twilight'],
	['/roadmap', 'rain'],
	['/blog', 'night']
];

export function moodFor(pathname: string): Mood {
	const match = PAGE_MOODS.find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
	return match ? match[1] : 'sunrise';
}

/** Whether the sky is dark enough that text over it should be pale. */
export function hasDarkSky(mood: Mood): boolean {
	return mood === 'night' || mood === 'twilight';
}
