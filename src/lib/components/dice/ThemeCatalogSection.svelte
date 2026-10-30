<script lang="ts">
	import ThemeCard from '#lib/components/dice/ThemeCard.svelte';
	import type { CatalogTheme } from '#lib/dice/themeCatalog.js';

	interface Props {
		title: string;
		note?: string;
		themes: CatalogTheme[];
		selectedId?: string;
		onselect?: (id: string) => void;
	}

	let { title, note, themes, selectedId, onselect }: Props = $props();
</script>

<section class="card hud">
	<header>
		<h2>{title}</h2>
		{#if note}
			<p>{note}</p>
		{/if}
	</header>

	<!-- One catalogue's themes, banded together (see .hud-band in app.css). -->
	<ul class="hud-band theme-grid">
		{#each themes as entry (entry.id)}
			<li>
				<ThemeCard {entry} selected={selectedId === entry.id} {onselect} />
			</li>
		{/each}
	</ul>
</section>

<style>
	header {
		margin-bottom: 1.5rem;
	}

	p {
		margin: 0;
		font-size: 0.98rem;
		line-height: 1.65;
		color: var(--hud-dim);
	}

	.theme-grid {
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
	}

	/* The card is the whole panel, so it brings its own padding. */
	.theme-grid > li {
		padding: 0;
	}
</style>
