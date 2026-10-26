<script lang="ts">
	import { onMount } from 'svelte';
	import type { CityHeroMode, CityHeroScene } from '#lib/city/CityHeroScene.js';

	const GLB_URL = '/city/hero.glb';
	const PROPS_URL = '/city/hero_props.json';
	const STILL_URL = '/city/hero-still.webp';
	/** localStorage key remembering the visitor's day/night choice. */
	const MODE_KEY = 'city-mode';

	/** The saved mode; day when nothing (or nothing readable) is stored. */
	function readMode(): CityHeroMode {
		try {
			return localStorage.getItem(MODE_KEY) === 'night' ? 'night' : 'day';
		} catch {
			return 'day';
		}
	}

	function saveMode(value: CityHeroMode): void {
		try {
			localStorage.setItem(MODE_KEY, value);
		} catch {
			// Storage blocked (private window, disabled site data): the choice just isn't remembered.
		}
	}

	let canvas: HTMLCanvasElement | undefined = $state();
	let track: HTMLDivElement | undefined = $state();
	/** True once the live scene has loaded; the still then fades out. */
	let live = $state(false);
	let mode: CityHeroMode = $state('day');
	let scene: CityHeroScene | undefined;

	function toggleMode(): void {
		mode = mode === 'night' ? 'day' : 'night';
		saveMode(mode);
		scene?.setMode(mode);
	}

	/** Scroll progress 0..1 over the track (scrollToFrame clamps). */
	function scrollProgress(): number {
		const range = (track?.offsetHeight ?? 0) - window.innerHeight;
		return range > 0 ? window.scrollY / range : 0;
	}

	onMount(() => {
		mode = readMode();
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

		void import('#lib/city/CityHeroScene.js')
			.then(async ({ CityHeroScene }) => {
				if (disposed || !canvas) return;
				scene = new CityHeroScene(canvas, {
					reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
					mobile: window.matchMedia('(pointer: coarse)').matches
				});
				scene.setMode(mode);
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
<button
	type="button"
	class="mode"
	class:night={mode === 'night'}
	aria-pressed={mode === 'night'}
	onclick={toggleMode}
>
	Night
</button>

<style>
	/* Fixed behind the page: the layout's nav stays on top and clickable. The background
	   continues the still's top and bottom edges where it doesn't fill a tall screen. */
	.stage {
		position: fixed;
		inset: 0;
		z-index: -1;
		background: linear-gradient(#7f8e9d, #a3acb3);
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

	/*
	 * Narrower than about 1:1 the live scene stops cropping the sides and keeps the
	 * safe frame ("Welcome to Atlantis", hero_props safe_half_tan.f250 = 0.2998 of
	 * the 16:9 half-width tan 0.5296) across the full screen width. Show the 16:9
	 * still the same way, so the text isn't cut and the fade to live doesn't jump:
	 * 0.5296 / 0.2998 = 1.766 screen widths wide, centred. 16:9 / 1.766 = 1.007.
	 */
	@media (max-aspect-ratio: 1007/1000) {
		.still {
			inset: auto;
			top: 50%;
			left: 50%;
			width: 176.6%;
			height: auto;
			aspect-ratio: 16 / 9;
			transform: translate(-50%, -50%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.still {
			transition: none;
		}
	}

	.track {
		height: 400vh;
	}

	/* Day/night toggle, bottom-right corner, above the fixed stage. */
	.mode {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 1;
		padding: 0.5rem 1rem;
		border: 1px solid rgb(255 255 255 / 0.6);
		border-radius: 999px;
		background: rgb(20 30 50 / 0.55);
		color: #fff;
		font: inherit;
		cursor: pointer;
		backdrop-filter: blur(4px);
	}

	.mode.night {
		background: rgb(255 214 150 / 0.85);
		color: #1a1a2e;
	}

	.mode:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}
</style>
