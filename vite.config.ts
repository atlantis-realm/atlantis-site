import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			'@ladyofcode/dice-engine/engine': path.resolve(dir, 'node_modules/@ladyofcode/dice-engine/engine'),
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
