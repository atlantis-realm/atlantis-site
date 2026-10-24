<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import MainMenu from '#lib/components/navigation/MainMenu.svelte';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<MainMenu />

{@render children?.()}
