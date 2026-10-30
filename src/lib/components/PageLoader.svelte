<script lang="ts">
	// A cover held over the page until its scenes are ready: a thin bar fills across the middle as
	// they load, then runs off to the right as the cover fades away (after the loading-progress
	// lesson in threejs-tuts). It's in the prerendered HTML, so it's up from the very first paint.
	let { progress, done }: { progress: number; done: boolean } = $props();

	// A beat on the full bar before it goes, so it doesn't vanish the instant it fills.
	const HOLD_MS = 500;

	let ended = $state(false);
	let gone = $state(false);

	$effect(() => {
		if (!done) return;
		const timeout = setTimeout(() => (ended = true), HOLD_MS);
		return () => clearTimeout(timeout);
	});

	function onTransitionEnd(event: TransitionEvent): void {
		// The bar's own transitions bubble up here too; only the cover's fade removes it.
		if (ended && event.target === event.currentTarget) gone = true;
	}
</script>

<svelte:head>
	<!-- Nothing would ever finish loading without scripts, so don't cover the page. -->
	<noscript
		><style>
			.page-loader {
				display: none !important;
			}
		</style></noscript
	>
</svelte:head>

{#if !gone}
	<div
		class="page-loader"
		class:ended
		role="progressbar"
		aria-label="Loading"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={Math.round(progress * 100)}
		ontransitionend={onTransitionEnd}
	>
		<div class="bar" style:transform={ended ? undefined : `scaleX(${progress})`}></div>
	</div>
{/if}

<style>
	.page-loader {
		position: fixed;
		inset: 0;
		/* Over the nav as well as the content. */
		z-index: 100;
		background: #000;
		transition: opacity 2s ease;
	}

	.page-loader.ended {
		opacity: 0;
		pointer-events: none;
	}

	.bar {
		position: absolute;
		top: 50%;
		width: 100%;
		height: 2px;
		background: hsl(185, 90%, 60%);
		transform: scaleX(0);
		transform-origin: top left;
		transition: transform 0.5s;
	}

	.ended .bar {
		transform: scaleX(0);
		transform-origin: top right;
		transition: transform 1.5s ease-in-out;
	}

	/* Still fades (just near-instantly), so the transitionend that removes it still fires. */
	@media (prefers-reduced-motion: reduce) {
		.page-loader,
		.bar,
		.ended .bar {
			transition-duration: 1ms;
		}
	}
</style>
