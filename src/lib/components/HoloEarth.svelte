<script lang="ts">
	import { onMount } from 'svelte';
	import { getLoadingTracker } from '#lib/loading.svelte.js';
	import type { HoloEarth } from '#lib/home/HoloEarth.js';

	let canvas: HTMLCanvasElement | undefined = $state();
	// Building it compiles its shaders, so a page with a loading screen waits for that too.
	const loading = getLoadingTracker();

	onMount(() => {
		if (!canvas) return;

		let earth: HoloEarth | undefined;
		let resizeObserver: ResizeObserver | undefined;
		let visibilityObserver: IntersectionObserver | undefined;
		let unmounted = false;

		const ready = import('#lib/home/HoloEarth.js').then(({ HoloEarth }) => {
			if (unmounted || !canvas) return;

			earth = new HoloEarth(canvas);
			resizeObserver = new ResizeObserver(() => earth?.resize());
			resizeObserver.observe(canvas);
			// Only spin while it's on screen; the water scene behind is already busy.
			visibilityObserver = new IntersectionObserver(([entry]) => {
				if (entry.isIntersecting) earth?.start();
				else earth?.stop();
			});
			visibilityObserver.observe(canvas);
		});
		loading?.track(ready);

		return () => {
			unmounted = true;
			resizeObserver?.disconnect();
			visibilityObserver?.disconnect();
			earth?.destroy();
		};
	});
</script>

<canvas bind:this={canvas} class="holo-earth" aria-hidden="true"></canvas>

<style>
	.holo-earth {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
	}
</style>
