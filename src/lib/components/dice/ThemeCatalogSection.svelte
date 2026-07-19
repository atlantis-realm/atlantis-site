<script lang="ts">
	import ThemeCard from '$lib/components/dice/ThemeCard.svelte';
	import type { CatalogTheme } from '$lib/dice/themeCatalog';

	interface Props {
		title: string;
		note?: string;
		themes: CatalogTheme[];
		selectedId?: string;
		onselect?: (id: string) => void;
	}

	let { title, note, themes, selectedId, onselect }: Props = $props();
</script>

<section class="catalog-section">
	<header>
		<h2>{title}</h2>
		{#if note}
			<p>{note}</p>
		{/if}
	</header>

	<div class="theme-grid" role="list">
		{#each themes as entry (entry.id)}
			<div role="listitem">
				<ThemeCard {entry} selected={selectedId === entry.id} {onselect} />
			</div>
		{/each}
	</div>
</section>

<style>
	.catalog-section {
		margin-top: 2.5rem;
	}

	header {
		margin-bottom: 1rem;
	}

	h2 {
		margin: 0 0 0.5rem;
		font-family: 'Cinzel Decorative', cursive;
		font-size: 1.45rem;
		color: hsl(45, 67%, 74%);
		letter-spacing: 0.06em;
	}

	p {
		margin: 0;
		font-size: 0.98rem;
		line-height: 1.65;
		color: rgba(238, 239, 183, 0.82);
	}

	.theme-grid {
		display: grid;
		gap: 0.85rem;
	}

	@media (min-width: 640px) {
		.theme-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 960px) {
		.theme-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
