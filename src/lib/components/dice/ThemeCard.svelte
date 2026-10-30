<script lang="ts">
	import {
		resolveCatalogTheme,
		themeChatCommand,
		type CatalogTheme
	} from '#lib/dice/themeCatalog.js';

	interface Props {
		entry: CatalogTheme;
		selected?: boolean;
		onselect?: (id: string) => void;
	}

	let { entry, selected = false, onselect }: Props = $props();

	const theme = $derived(resolveCatalogTheme(entry));
	const chatCommand = $derived(themeChatCommand(entry));
</script>

<button
	type="button"
	class="theme-card"
	class:selected
	class:unavailable={!theme.available}
	data-tier={entry.tier}
	aria-pressed={selected}
	disabled={!theme.available}
	onclick={() => onselect?.(entry.id)}
>
	<span class="swatch" aria-hidden="true">
		<span class="swatch-body" style:background={theme.dieColor}></span>
		<span class="swatch-glow" style:background={theme.emissiveColor}></span>
	</span>

	<span class="copy">
		<span class="title-row">
			<span class="title">{theme.label}</span>
			{#if entry.tier === 'subscriber'}
				<span class="badge">Sub</span>
			{/if}
		</span>
		<code class="command">{chatCommand}</code>
		{#if entry.description}
			<span class="description">{entry.description}</span>
		{/if}
		{#if !theme.available}
			<span class="status">Coming soon in dice-roller</span>
		{/if}
	</span>
</button>

<style>
	/* Fills its panel in the band; the band draws the panel itself. */
	.theme-card {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		width: 100%;
		height: 100%;
		padding: 1.1rem 1.25rem;
		border: none;
		background: none;
		color: var(--hud-text);
		font-family: var(--hud-font);
		text-align: left;
		cursor: pointer;
		transition:
			background 0.15s ease,
			box-shadow 0.15s ease;
	}

	.theme-card:hover:not(:disabled) {
		background: hsl(185 90% 60% / 0.06);
	}

	/* Picked: framed in cyan. */
	.theme-card.selected {
		background: hsl(185 90% 60% / 0.1);
		box-shadow: inset 0 0 0 2px var(--hud-accent);
	}

	.theme-card:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.swatch {
		position: relative;
		flex-shrink: 0;
		width: 3.25rem;
		height: 3.25rem;
		border-radius: 999px;
		overflow: hidden;
		border: 1px solid hsl(185 90% 60% / 0.3);
	}

	.swatch-body,
	.swatch-glow {
		position: absolute;
		inset: 0;
	}

	.swatch-glow {
		opacity: 0.45;
		mix-blend-mode: screen;
		transform: scale(0.72);
		border-radius: 999px;
		filter: blur(6px);
	}

	.copy {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.title {
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--hud-heading);
	}

	.command {
		align-self: flex-start;
		padding: 0.15rem 0.45rem;
		border: 1px solid hsl(185 90% 60% / 0.3);
		background: rgb(0 0 0 / 0.25);
		color: var(--hud-accent);
		font-family: var(--hud-font);
		font-size: 0.82rem;
		line-height: 1.4;
	}

	/* A tiny tag with one corner cut, like the HUD buttons. */
	.badge {
		padding: 0.1rem 0.5rem;
		background: var(--hud-accent);
		color: #06121e;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		clip-path: polygon(0 0, calc(100% - 5px) 0, 100% 5px, 100% 100%, 0 100%);
	}

	.description,
	.status {
		font-size: 0.9rem;
		line-height: 1.55;
	}

	.status {
		color: var(--hud-dim);
		font-style: italic;
	}
</style>
