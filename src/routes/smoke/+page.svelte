<script lang="ts">
	import { onMount } from 'svelte';
	import type { SmokeScene } from '#lib/smoke/SmokeScene.js';

	let canvas: HTMLCanvasElement | undefined = $state();
	let track: HTMLDivElement | undefined = $state();

	/** Scroll progress 0..1 over the track (setScroll clamps). */
	function scrollProgress(): number {
		const range = (track?.offsetHeight ?? 0) - window.innerHeight;
		return range > 0 ? window.scrollY / range : 0;
	}

	onMount(() => {
		let disposed = false;
		let scene: SmokeScene | undefined;
		const onScroll = (): void => scene?.setScroll(scrollProgress());
		const onResize = (): void => {
			scene?.resize(window.innerWidth, window.innerHeight);
			onScroll();
		};

		// Imported lazily so the prerender never touches WebGL.
		void import('#lib/smoke/SmokeScene.js').then(({ SmokeScene }) => {
			if (disposed || !canvas) return;
			scene = new SmokeScene(canvas);
			if (import.meta.env.DEV) {
				(window as unknown as { __smoke?: SmokeScene }).__smoke = scene;
			}
			onResize();
			window.addEventListener('scroll', onScroll, { passive: true });
			window.addEventListener('resize', onResize);
		});

		// Stop rendering while the section is out of view. On this page it always is in view; this
		// matters once the section sits under the homepage.
		const visibility = new IntersectionObserver(([entry]) => {
			scene?.setActive(entry.isIntersecting);
		});
		if (track) visibility.observe(track);

		return () => {
			disposed = true;
			visibility.disconnect();
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onResize);
			scene?.destroy();
		};
	});
</script>

<svelte:head>
	<title>Atlantis · Smoke</title>
</svelte:head>

<div class="stage">
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>
<div class="track" bind:this={track}></div>

<style>
	/* Fixed behind the page so the layout's nav stays on top and clickable. */
	.stage {
		position: fixed;
		inset: 0;
		z-index: -1;
		background: #000;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* Scroll length of the descent; its height sets how much scrolling the whole dive takes. */
	.track {
		height: 500vh;
	}
</style>
