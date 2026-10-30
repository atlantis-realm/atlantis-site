<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import MainMenu from '#lib/components/navigation/MainMenu.svelte';
	import OceanBackground from '#lib/components/background/OceanBackground.svelte';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { preloadCode } from '$app/navigation';
	import PageLoader from '#lib/components/PageLoader.svelte';
	import { LoadingTracker, setLoadingTracker } from '#lib/loading.svelte.js';
	import '@fontsource/cinzel-decorative/700.css';
	import '@fontsource-variable/ubuntu-sans-mono/wght.css';
	// Preloaded so the first paint's headings and body text don't wait on the CSS to discover them.
	import cinzelLatin from '@fontsource/cinzel-decorative/files/cinzel-decorative-latin-700-normal.woff2?url';
	import ubuntuMonoLatin from '@fontsource-variable/ubuntu-sans-mono/files/ubuntu-sans-mono-latin-wght-normal.woff2?url';
	import '../app.css';

	let { children } = $props();

	// The first load, whichever page it lands on, is held behind a loading screen until that page's
	// scenes are built and their shaders compiled (they track themselves), and until the code for
	// every other page and scene has downloaded, so moving around the site afterwards doesn't wait
	// on the network. Later navigations don't bring the screen back.
	const loading = new LoadingTracker();
	setLoadingTracker(loading);

	// Route IDs: every blog post shares /blog/[slug]'s code.
	const PAGES = [
		'/',
		'/about',
		'/about/team',
		'/blog',
		'/blog/[slug]',
		'/events',
		'/projects',
		'/roadmap',
		'/ladyofcode/dice-themes'
	] as const;

	onMount(() => {
		loading.track(Promise.all(PAGES.map((path) => preloadCode(path))));
		// The 3D scenes are imported lazily (never during the prerender), so fetch them too.
		loading.track(
			Promise.all([
				import('#lib/home/HomeScene.js'),
				import('#lib/home/HoloEarth.js'),
				import('#lib/objects/NeonObjects.js'),
				import('#lib/water/OceanScene.js'),
				import('#lib/dice/DicePreviewScene.js')
			])
		);
	});

	// The homepage, /city, /smoke and /objects have their own scenes; every other page sits on open water.
	// It stays mounted while moving between those pages, so it isn't rebuilt on each navigation.
	// Error pages always get it, since an error on one of those routes replaces its scene.
	const OWN_SCENES = ['/', '/city', '/smoke', '/objects'];
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

<PageLoader progress={loading.progress} done={loading.done} />

{@render children?.()}
