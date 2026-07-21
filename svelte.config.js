import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Absolute /_app/ asset URLs so nested routes (e.g. /dice/themes) work
		// even when legacy paths like /ladyofcode/dice-themes are still linked.
		paths: {
			relative: false
		}
	}
};

export default config;
