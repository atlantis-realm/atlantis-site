<script lang="ts">
	import { onMount } from 'svelte';
	import type { CityHeroMode, CityHeroScene } from '#lib/city/CityHeroScene.js';
	import { coversViewport, heroScroll } from '#lib/city/heroCamera.js';
	import { readMode, saveMode } from '#lib/city/mode.js';

	const GLB_URL = '/city/hero.glb';
	const PROPS_URL = '/city/hero_props.json';
	const STILL_URL = '/city/hero-still.webp';

	let canvas: HTMLCanvasElement | undefined = $state();
	let below: HTMLElement | undefined = $state();
	let modeButton: HTMLButtonElement | undefined = $state();
	let live = $state(false);
	let toggleOverSection = $state(false);
	let mode: CityHeroMode = $state('day');
	let scene: CityHeroScene | undefined;

	function toggleMode(): void {
		mode = mode === 'night' ? 'day' : 'night';
		saveMode(mode);
		scene?.setMode(mode);
	}

	function scrollState(): { progress: number; drop: number; covered: boolean } {
		const h = window.innerHeight;
		if (!below) return { progress: 0, drop: 0, covered: false };
		const rect = below.getBoundingClientRect();
		const { progress, drop } = heroScroll(window.scrollY, rect.top + window.scrollY, h);
		return { progress, drop, covered: coversViewport(rect.top, rect.bottom, h) };
	}

	onMount(() => {
		mode = readMode();
		let disposed = false;

		const onScroll = (): void => {
			if (below && modeButton) {
				toggleOverSection =
					below.getBoundingClientRect().top < modeButton.getBoundingClientRect().bottom;
			}
			if (!scene) return;
			const { progress, drop, covered } = scrollState();
			scene.setScroll(progress, drop);
			scene.setPaused(covered);
		};
		const onResize = (): void => {
			scene?.resize(window.innerWidth, window.innerHeight);
			onScroll();
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onResize);
		onScroll();

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
<h1 class="visually-hidden">Atlantis city</h1>
<div class="track"></div>
<section class="below" class:night={live && mode === 'night'} bind:this={below}>
	<div class="cut" aria-hidden="true"></div>
	<div class="copy">
		<h2>The city on the sea</h2>
		<p>
			Atlantis does not sit on the sea floor. It floats, a raft of terraces and gardens riding the
			open ocean, and parts of it travel: outer districts unmoor and drift off for a season, then
			come home with new neighbours aboard.
		</p>
		<p>
			At its centre is Old Town, the oldest decks of the city, gathered round the Lantern. Its heart
			glows day and night, and every avenue leads back to it.
		</p>
		<p>
			Around Old Town, the neighbourhoods are cultural quarters, each building in its own way: its
			own rooflines, colours and courtyards, its own way of letting plants and light in. Walk a few
			streets and the city changes its voice.
		</p>
		<p>
			It is a hopeful place, built to be shared, repaired and grown, with room left over for whoever
			arrives next.
		</p>
	</div>
</section>
<button
	type="button"
	class="mode"
	class:night={mode === 'night'}
	class:over-section={toggleOverSection}
	bind:this={modeButton}
	aria-pressed={mode === 'night'}
	onclick={toggleMode}
>
	Night
</button>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&display=swap');
	@import url('https://fonts.googleapis.com/css2?family=Ubuntu+Sans+Mono:wght@400;500&display=swap');

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

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.below {
		--paving: #b8b9bf;
		--joint: #8d8f97;
		--stone: #6f6a62;
		--sea-top: #12506f;
		--sea: #0b2f48;
		--text: #eeefb7;
		--body: #e3ecf0;
		position: relative;
		min-height: 100vh;
		background: linear-gradient(var(--sea-top), var(--sea) 60vh);
		color: var(--body);
		font-family: 'Ubuntu Sans Mono', monospace;
	}

	.below.night {
		--paving: #162a46;
		--joint: #0e1a2e;
		--stone: #262a33;
		--sea-top: #0a2438;
		--sea: #050f1c;
		--text: #eeefb7;
		--body: #cfd8e0;
	}

	.cut {
		height: 2.25rem;
		background: linear-gradient(
			var(--paving) 0 0.5rem,
			var(--joint) 0.5rem calc(0.5rem + 2px),
			var(--stone) calc(0.5rem + 2px) 1.75rem,
			color-mix(in srgb, var(--stone), var(--sea-top)) 1.75rem
		);
	}

	.copy {
		max-width: 38rem;
		margin: 0 auto;
		padding: 3rem 1rem 6rem;
		line-height: 1.7;
	}

	.copy h2 {
		margin: 0 0 1.5rem;
		color: var(--text);
		font-family: 'Cinzel Decorative', cursive;
		font-size: clamp(1.6rem, 5vw, 2.4rem);
		letter-spacing: 1px;
		line-height: 1.2;
	}

	.copy p {
		margin: 0 0 1.2rem;
		font-size: 1.05rem;
	}

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

	@media (max-width: 52rem) {
		.mode {
			transition:
				opacity 0.3s ease,
				visibility 0.3s;
		}

		.mode.over-section {
			opacity: 0;
			visibility: hidden;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mode {
			transition: none;
		}
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
