<script lang="ts">
	import { onMount } from 'svelte';
	import ThemeCatalogSection from '$lib/components/dice/ThemeCatalogSection.svelte';
	import {
		DEFAULT_DIE_INDEX,
		DICE_TYPES,
		dieLabel,
		type DiceLayoutMode
	} from '$lib/dice/constants';
	import { PUBLIC_THEMES, SUBSCRIBER_THEMES } from '$lib/dice/themeCatalog';
	import type { DicePreviewScene } from '$lib/dice/DicePreviewScene';
	import { DEFAULT_THEME, getTheme } from '@ladyofcode/dice-themes';

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

		void import('$lib/dice/DicePreviewScene').then(({ DicePreviewScene }) => {
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

		return () => {
			cleanup?.();
		};
	});
</script>

<svelte:head>
	<title>Dice Themes · Atlantis</title>
</svelte:head>

<section class="dice-themes-page">
	<div class="content-wrapper">
		<header>
			<h1>Dice Themes</h1>
			<p class="lede">
				Browse themes below and preview them on the dice set. During stream, use the chat command on each
				card to set your theme.
			</p>
			<p class="policy-note">
				You can only change your theme during stream once every 20 minutes. After we migrate to Grid,
				you'll have your own settings page to pick your theme whenever.
			</p>
		</header>

		<div class="canvas-shell">
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
</section>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&display=swap');
	@import url('https://fonts.googleapis.com/css2?family=Ubuntu+Sans+Mono:wght@400;500;600;700&display=swap');

	.dice-themes-page {
		min-height: 100vh;
		background: linear-gradient(to bottom, #2e4057 0%, #1a2838 100%);
		padding: 80px 20px 40px;
		color: #eeefb7;
		font-family: 'Ubuntu Sans Mono', monospace;
	}

	.content-wrapper {
		max-width: 1200px;
		margin: 0 auto;
	}

	header {
		text-align: center;
		margin-bottom: 2rem;
	}

	h1 {
		font-family: 'Cinzel Decorative', cursive;
		font-size: clamp(2rem, 5vw, 3rem);
		margin: 0 0 1rem;
		color: hsl(45, 67%, 74%);
		letter-spacing: 2px;
	}

	.lede {
		margin: 0;
		font-size: 1.05rem;
		color: rgba(238, 239, 183, 0.85);
		line-height: 1.7;
	}

	.policy-note {
		margin: 1rem auto 0;
		max-width: 42rem;
		font-size: 0.98rem;
		line-height: 1.65;
		color: rgba(238, 239, 183, 0.72);
		text-align: center;
	}

	.canvas-shell {
		height: min(52vh, 520px);
		min-height: 280px;
		border-radius: 12px;
		border: 1px solid rgba(238, 239, 183, 0.18);
		background: radial-gradient(circle at 50% 35%, rgba(46, 64, 87, 0.95), rgba(20, 30, 44, 0.98));
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

	.nav {
		position: absolute;
		top: 50%;
		z-index: 1;
		transform: translateY(-50%);
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid rgba(238, 239, 183, 0.35);
		border-radius: 999px;
		background: rgba(20, 30, 44, 0.72);
		color: hsl(45, 67%, 74%);
		font-size: 1.75rem;
		line-height: 1;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			opacity 0.15s ease;
	}

	.nav:hover:not(:disabled) {
		background: rgba(46, 64, 87, 0.95);
		border-color: hsl(45, 67%, 74%);
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
		padding: 0.2rem 0.65rem;
		border-radius: 999px;
		background: rgba(20, 30, 44, 0.72);
		border: 1px solid rgba(238, 239, 183, 0.22);
		color: hsl(45, 67%, 74%);
		font-family: 'Ubuntu Sans Mono', monospace;
		font-size: 0.95rem;
		letter-spacing: 0.08em;
	}

	@media (min-width: 768px) {
		.canvas-frame[data-layout='tablet'] .nav {
			width: 3rem;
			height: 3rem;
		}
	}
</style>
