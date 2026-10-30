<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import type { OceanScene } from '#lib/water/OceanScene.js';
	import { getLoadingTracker } from '#lib/loading.svelte.js';
	import { moodFor } from '#lib/water/mood.js';

	let canvas: HTMLCanvasElement | undefined = $state();
	let scene: OceanScene | undefined = $state.raw();
	// On the first load, the loading screen waits for the water's shaders too.
	const loading = getLoadingTracker();

	// Each page has its own mood (see mood.ts). This stays mounted across pages, so moving between
	// them blends from one to the next.
	const mood = $derived(moodFor(page.url.pathname));
	$effect(() => scene?.setMood(mood));
	let remeasure: (() => void) | undefined;

	// This stays mounted across pages, so pick up each new page's length and scroll position.
	afterNavigate(() => remeasure?.());

	onMount(() => {
		let disposed = false;
		// The camera finishes going through the surface just before the page's content (marked by
		// OceanPage) scrolls into view, so the content only ever appears underwater. The crossing
		// ends this much (screen heights) early, since the camera eases after the scroll, and always
		// takes at least the minimum, so it never snaps. Pages without marked content cross over a
		// fixed stretch.
		const LEAD_SCREENS = 0.1;
		const MIN_CROSS_SCREENS = 0.25;
		const FALLBACK_CROSS_SCREENS = 0.6;
		// Scroll distances for the crossing and the rest of the page. Layout only changes on
		// navigation, resize, or the page's content changing size, so it's measured then rather than
		// on every scroll event.
		let cross = 1;
		let rest = 0;
		const onScroll = (): void => {
			scene?.setScroll(window.scrollY / cross, rest > 0 ? (window.scrollY - cross) / rest : 0);
		};
		const measure = (): void => {
			const h = window.innerHeight;
			const content = document.querySelector('[data-ocean-content]');
			const contentTop = content ? content.getBoundingClientRect().top + window.scrollY : null;
			cross = Math.max(
				contentTop !== null ? contentTop - h - LEAD_SCREENS * h : FALLBACK_CROSS_SCREENS * h,
				MIN_CROSS_SCREENS * h
			);
			rest = document.documentElement.scrollHeight - h - cross;
			onScroll();
		};
		remeasure = measure;
		const onResize = (): void => {
			scene?.resize(window.innerWidth, window.innerHeight);
			measure();
		};
		// Catches content that changes the page's length after navigation (images, fonts loading).
		const contentSize = new ResizeObserver(measure);
		contentSize.observe(document.body);

		// Imported lazily so the prerender never touches WebGL.
		const ready = import('#lib/water/OceanScene.js').then(({ OceanScene }) => {
			if (disposed || !canvas) return;
			const ocean = new OceanScene(canvas);
			// The first page starts in its own mood rather than blending into it.
			ocean.setMood(mood, true);
			scene = ocean;
			onResize();
			window.addEventListener('scroll', onScroll, { passive: true });
			window.addEventListener('resize', onResize);
			return ocean.warmUp();
		});
		loading?.track(ready);

		return () => {
			disposed = true;
			remeasure = undefined;
			contentSize.disconnect();
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onResize);
			scene?.destroy();
			scene = undefined;
		};
	});
</script>

<div class="ocean">
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
	/* Fixed behind the page, so the nav and content draw over it. */
	.ocean {
		position: fixed;
		inset: 0;
		z-index: -1;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
