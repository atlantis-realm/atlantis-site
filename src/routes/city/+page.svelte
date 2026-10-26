<script lang="ts">
	import { onMount } from 'svelte';
	import type { CityHeroScene } from '$lib/city/CityHeroScene';

	const GLB_URL = '/city/hero.glb';
	const PROPS_URL = '/city/hero_props.json';
	const STILL_URL = '/city/hero-still.webp';

	let canvas: HTMLCanvasElement | undefined = $state();
	let track: HTMLDivElement | undefined = $state();
	/** True once the live scene has loaded; the still then fades out. */
	let live = $state(false);

	/** Scroll progress 0..1 over the track (scrollToFrame clamps). */
	function scrollProgress(): number {
		const range = (track?.offsetHeight ?? 0) - window.innerHeight;
		return range > 0 ? window.scrollY / range : 0;
	}

	onMount(() => {
		let scene: CityHeroScene | undefined;
		let disposed = false;

		const onScroll = (): void => scene?.setScroll(scrollProgress());
		const onResize = (): void => {
			scene?.resize(window.innerWidth, window.innerHeight);
			onScroll();
		};

		// Any failure keeps the still on screen: no WebGL, or the glb/props fail to load.
		const fail = (err: unknown): void => {
			console.warn('City hero: showing the still instead of the live scene.', err);
			scene?.destroy();
			scene = undefined;
		};

		void import('$lib/city/CityHeroScene')
			.then(async ({ CityHeroScene }) => {
				if (disposed || !canvas) return;
				scene = new CityHeroScene(canvas, {
					reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
					mobile: window.matchMedia('(pointer: coarse)').matches
				});
				if (import.meta.env.DEV) {
					(window as unknown as { __cityHero?: CityHeroScene }).__cityHero = scene;
				}
				onResize();
				window.addEventListener('scroll', onScroll, { passive: true });
				window.addEventListener('resize', onResize);
				await scene.load(GLB_URL, PROPS_URL);
				if (disposed) return;
				onResize();
				live = true;
			})
			.catch(fail);

		return () => {
			disposed = true;
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onResize);
			scene?.destroy();
			scene = undefined;
		};
	});
</script>

<svelte:head>
	<title>Atlantis · City</title>
</svelte:head>

<div class="stage">
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
	<img
		class="still"
		class:hidden={live}
		src={STILL_URL}
		alt="The Atlantis plaza well, with “Welcome to Atlantis” across the water"
	/>
</div>
<div class="track" bind:this={track}></div>

<style>
	/* Fixed behind the page: the layout's nav stays on top and clickable. */
	.stage {
		position: fixed;
		inset: 0;
		z-index: -1;
	}

	canvas,
	.still {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}

	.still {
		object-fit: cover;
		transition: opacity 0.8s ease;
	}

	.still.hidden {
		opacity: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.still {
			transition: none;
		}
	}

	.track {
		height: 400vh;
	}
</style>
