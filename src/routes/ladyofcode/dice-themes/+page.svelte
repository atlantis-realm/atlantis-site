<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
	import { onMount } from 'svelte';
	import ThemeCatalogSection from '#lib/components/dice/ThemeCatalogSection.svelte';
	import {
		DEFAULT_DIE_INDEX,
		DICE_TYPES,
		dieLabel,
		type DiceLayoutMode
	} from '#lib/dice/constants.js';
	import { PUBLIC_THEMES, SUBSCRIBER_THEMES } from '#lib/dice/themeCatalog.js';
	import type { DicePreviewScene } from '#lib/dice/DicePreviewScene.js';
	import { DEFAULT_THEME, getTheme } from '@ladyofcode/dice-themes';
	import { getLoadingTracker } from '#lib/loading.svelte.js';

	// On the first load, the loading screen waits for the dice preview to be set up.
	const loading = getLoadingTracker();

	const TABLET_MIN = 768;
	const DESKTOP_MIN = 1024;

	let canvas: HTMLCanvasElement | undefined = $state();
	let scene: DicePreviewScene | undefined;
	let activeIndex = $state(DEFAULT_DIE_INDEX);
	let layoutMode = $state<DiceLayoutMode>('desktop');
	let selectedThemeId = $state(DEFAULT_THEME);

	const activeLabel = $derived(dieLabel(DICE_TYPES[activeIndex]));
	const showCarousel = $derived(layoutMode !== 'desktop');
	const canGoPrev = $derived(activeIndex > 0);
	const canGoNext = $derived(activeIndex < DICE_TYPES.length - 1);

	function resolveLayoutMode(width: number): DiceLayoutMode {
		if (width >= DESKTOP_MIN) return 'desktop';
		if (width >= TABLET_MIN) return 'tablet';
		return 'mobile';
	}

	function syncScene(): void {
		scene?.setLayoutMode(layoutMode);
		scene?.setActiveIndex(activeIndex);
	}

	function selectTheme(themeId: string): void {
		if (!getTheme(themeId)) return;
		selectedThemeId = themeId;
		scene?.setTheme(themeId);
	}

	function goPrev(): void {
		if (!canGoPrev) return;
		activeIndex -= 1;
		syncScene();
	}

	function goNext(): void {
		if (!canGoNext) return;
		activeIndex += 1;
		syncScene();
	}

	onMount(() => {
		if (!canvas) return;

		let cleanup: (() => void) | undefined;

		const ready = import('#lib/dice/DicePreviewScene.js').then(({ DicePreviewScene }) => {
			if (!canvas) return;

			scene = new DicePreviewScene(canvas);
			selectedThemeId = scene.getTheme();
			layoutMode = resolveLayoutMode(window.innerWidth);
			activeIndex = DEFAULT_DIE_INDEX;
			syncScene();

			const observer = new ResizeObserver(() => {
				scene?.resize();
			});
			observer.observe(canvas);

			const mediaTablet = window.matchMedia(`(min-width: ${TABLET_MIN}px)`);
			const mediaDesktop = window.matchMedia(`(min-width: ${DESKTOP_MIN}px)`);

			const onBreakpointChange = (): void => {
				layoutMode = resolveLayoutMode(window.innerWidth);
				syncScene();
			};

			mediaTablet.addEventListener('change', onBreakpointChange);
			mediaDesktop.addEventListener('change', onBreakpointChange);

			cleanup = () => {
				observer.disconnect();
				mediaTablet.removeEventListener('change', onBreakpointChange);
				mediaDesktop.removeEventListener('change', onBreakpointChange);
				scene?.destroy();
				scene = undefined;
			};
		});
		loading?.track(ready);

		return () => {
			cleanup?.();
		};
	});
</script>

<svelte:head>
	<title>Dice Themes · Atlantis</title>
</svelte:head>

<OceanPage title="Dice Themes">
	<div class="dice-themes">
		<section class="card hud">
			<p class="lede">
				Browse themes below and preview them on the dice set. During stream, use the chat command on
				each card to set your theme.
			</p>
			<p class="policy-note">
				You can only change your theme during stream once every 20 minutes. After we migrate to
				Grid, you'll have your own settings page to pick your theme whenever.
			</p>
		</section>

		<div class="canvas-shell hud">
			<div class="canvas-frame" data-layout={layoutMode}>
				{#if showCarousel}
					<button
						type="button"
						class="nav prev"
						aria-label="Previous die"
						disabled={!canGoPrev}
						onclick={goPrev}
					>
						‹
					</button>
				{/if}

				<canvas bind:this={canvas} aria-label="Dice theme preview showing {activeLabel}"></canvas>

				{#if showCarousel}
					<button
						type="button"
						class="nav next"
						aria-label="Next die"
						disabled={!canGoNext}
						onclick={goNext}
					>
						›
					</button>

					<p class="die-label" aria-live="polite">{activeLabel}</p>
				{/if}
			</div>
		</div>

		<ThemeCatalogSection
			title="Everyone"
			themes={PUBLIC_THEMES}
			selectedId={selectedThemeId}
			onselect={selectTheme}
		/>

		<ThemeCatalogSection
			title="Subscribers"
			note="Extra themes for the Atlantis Angels. Thanks for your investment."
			themes={SUBSCRIBER_THEMES}
			selectedId={selectedThemeId}
			onselect={selectTheme}
		/>
	</div>
</OceanPage>

<style>
	.dice-themes {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.lede {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.7;
	}

	.policy-note {
		margin: 1rem 0 0;
		max-width: 42rem;
		font-size: 0.95rem;
		line-height: 1.65;
		color: var(--hud-dim);
	}

	/* The preview in a HUD frame (see .hud in app.css), edge to edge inside it. */
	.canvas-shell {
		height: min(52vh, 520px);
		min-height: 280px;
		padding: 0;
		background: radial-gradient(circle at 50% 35%, rgb(10 44 64 / 0.9), rgb(4 14 24 / 0.95));
		overflow: hidden;
	}

	.canvas-frame {
		position: relative;
		width: 100%;
		height: 100%;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* Small square HUD buttons with one corner cut. */
	.nav {
		position: absolute;
		top: 50%;
		z-index: 1;
		transform: translateY(-50%);
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid var(--hud-accent);
		background: rgb(6 18 30 / 0.8);
		color: var(--hud-accent);
		font-family: var(--hud-font);
		font-size: 1.75rem;
		line-height: 1;
		cursor: pointer;
		clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%);
		transition:
			background 0.15s ease,
			color 0.15s ease,
			opacity 0.15s ease;
	}

	.nav:hover:not(:disabled) {
		background: var(--hud-accent);
		color: #06121e;
	}

	.nav:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.prev {
		left: 0.75rem;
	}

	.next {
		right: 0.75rem;
	}

	.die-label {
		position: absolute;
		left: 50%;
		bottom: 0.85rem;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.25rem 0.75rem;
		border: 1px solid hsl(185 90% 60% / 0.5);
		background: rgb(6 18 30 / 0.8);
		color: var(--hud-accent);
		font-family: var(--hud-font);
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.15em;
		text-transform: uppercase;
	}

	@media (min-width: 768px) {
		.canvas-frame[data-layout='tablet'] .nav {
			width: 3rem;
			height: 3rem;
		}
	}
</style>
