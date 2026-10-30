<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { wave } from '#lib/actions/wave.js';
	import { hasDarkSky, moodFor } from '#lib/water/mood.js';

	/*
	 * Layout for the pages that sit on the ocean background: a big title above the water at the top,
	 * then a long stretch of open sea, then the content's cards. The page scrolls normally; the
	 * background goes through the surface just before the cards arrive (it reads where they start
	 * from data-ocean-content), so they're always underwater, then dives as the page scrolls on.
	 */
	let {
		title,
		above,
		children
	}: {
		title: string;
		/** Anything that belongs above the water with the title, such as a back link. */
		above?: Snippet;
		children: Snippet;
	} = $props();

	// Over a dark sky (night, twilight; see OceanBackground) the title turns pale, fading with it.
	const darkSky = $derived(hasDarkSky(moodFor(page.url.pathname)));
</script>

<header class="title-band">
	{@render above?.()}
	<h1 class:dark-sky={darkSky} use:wave={title}>{title}</h1>
</header>

<main class="content" data-ocean-content>
	{@render children()}
</main>

<style>
	/* The title sits over the sky and open water, well down the first screen. */
	.title-band {
		min-height: 42vh;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		padding: 0 clamp(1rem, 4vw, 3rem) 1rem;
		box-sizing: border-box;
	}

	/* The homepage's hard uppercase mono, big. */
	h1 {
		margin: 0;
		font-family: var(--hud-font);
		font-size: clamp(2.5rem, 7vw, 5.5rem);
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: #13283f;
		transition: color 0.9s ease;
	}

	h1.dark-sky {
		color: hsl(200, 60%, 85%);
	}

	/* The gap above the cards is the time spent above water before the plunge. Bottom room, so even
	   a short page scrolls far enough to dive into the dark. */
	.content {
		max-width: 1100px;
		margin: 90vh auto 0;
		padding: 0 clamp(1rem, 4vw, 3rem) 60vh;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		font-family: var(--hud-font);
		color: var(--hud-text);
	}
</style>
