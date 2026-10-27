import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev only: reload the page when a city hero export lands in static/city/
 * (hero.glb, hero_props.json). Vite doesn't watch static/ itself. Debounced,
 * because an export writes several files in a row.
 */
function reloadOnCityExport(): Plugin {
	const cityDir = path.resolve(dir, 'static/city');
	return {
		name: 'reload-on-city-export',
		apply: 'serve',
		configureServer(server) {
			server.watcher.add(cityDir);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const onFile = (file: string) => {
				if (!file.startsWith(cityDir + path.sep)) return;
				clearTimeout(timer);
				timer = setTimeout(() => server.ws.send({ type: 'full-reload' }), 500);
			};
			server.watcher.on('add', onFile);
			server.watcher.on('change', onFile);
		}
	};
}

export default defineConfig({
	plugins: [
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter(),
			// Absolute /_app/ asset URLs for nested routes like /ladyofcode/dice-themes.
			paths: { relative: false }
		}),
		reloadOnCityExport()
	],
	resolve: {
		alias: {
			'@ladyofcode/dice-engine/engine': path.resolve(
				dir,
				'node_modules/@ladyofcode/dice-engine/engine'
			),
			three: path.resolve(dir, 'node_modules/three')
		},
		dedupe: ['three']
	},
	optimizeDeps: {
		include: ['three']
	},
	ssr: {
		noExternal: ['@ladyofcode/dice-engine', '@ladyofcode/dice-themes']
	}
});
