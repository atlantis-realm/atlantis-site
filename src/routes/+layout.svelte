<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import MainMenu from '#lib/components/navigation/MainMenu.svelte';
	import OceanBackground from '#lib/components/background/OceanBackground.svelte';
	import { page } from '$app/state';
	import '../app.css';

	let { children } = $props();

	// The homepage, /city and /smoke have their own scenes; every other page sits on open water.
	// It stays mounted while moving between those pages, so it isn't rebuilt on each navigation.
	// Error pages always get it, since an error on one of those routes replaces its scene.
	const OWN_SCENES = ['/', '/city', '/smoke'];
	const ocean = $derived(
		page.error != null || !OWN_SCENES.includes(page.url.pathname.replace(/(.)\/$/, '$1'))
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if ocean}
	<OceanBackground />
{/if}

<MainMenu />

{@render children?.()}
