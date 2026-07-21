import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Absolute /_app/ asset URLs for nested routes like /ladyofcode/dice-themes.
		paths: {
			relative: false
		}
	}
};

export default config;
