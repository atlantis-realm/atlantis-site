<script lang="ts">
	import { onMount } from 'svelte';
	import { getLoadingTracker } from '#lib/loading.svelte.js';
	import type { NeonObjectKind, NeonStage } from '#lib/objects/NeonObjects.js';

	let { kind }: { kind: NeonObjectKind } = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	// Building it compiles its shaders, so a page with a loading screen waits for that too.
	const loading = getLoadingTracker();

	onMount(() => {
		if (!canvas) return;

		let stage: NeonStage | undefined;
		let resizeObserver: ResizeObserver | undefined;
		let visibilityObserver: IntersectionObserver | undefined;
		let unmounted = false;

		const ready = import('#lib/objects/NeonObjects.js').then(({ NeonStage }) => {
			if (unmounted || !canvas) return;

			stage = new NeonStage(canvas, kind);
			resizeObserver = new ResizeObserver(() => stage?.resize());
			resizeObserver.observe(canvas);
			// Only animate while it's on screen; the water scene behind is already busy.
			visibilityObserver = new IntersectionObserver(([entry]) => {
				if (entry.isIntersecting) stage?.start();
				else stage?.stop();
			});
			visibilityObserver.observe(canvas);
		});
		loading?.track(ready);

		return () => {
			unmounted = true;
			resizeObserver?.disconnect();
			visibilityObserver?.disconnect();
			stage?.destroy();
		};
	});
</script>

<canvas bind:this={canvas} class="neon-object" aria-hidden="true"></canvas>

<style>
	.neon-object {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
	}
</style>
