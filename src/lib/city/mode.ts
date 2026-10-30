import type { CityHeroMode } from './CityHeroScene.ts';

const MODE_KEY = 'city-mode';

export function readMode(): CityHeroMode {
	try {
		return localStorage.getItem(MODE_KEY) === 'night' ? 'night' : 'day';
	} catch {
		return 'day';
	}
}

export function saveMode(value: CityHeroMode): void {
	try {
		localStorage.setItem(MODE_KEY, value);
	} catch {}
}
