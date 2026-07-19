<script lang="ts">
	import { resolveCatalogTheme, themeChatCommand, type CatalogTheme } from '$lib/dice/themeCatalog';

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
	.theme-card {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		width: 100%;
		padding: 1rem 1.1rem;
		border-radius: 10px;
		border: 1px solid rgba(238, 239, 183, 0.18);
		background: rgba(20, 30, 44, 0.55);
		color: #eeefb7;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background 0.15s ease,
			transform 0.15s ease;
	}

	.theme-card:hover:not(:disabled) {
		border-color: rgba(238, 239, 183, 0.42);
		background: rgba(30, 40, 57, 0.72);
	}

	.theme-card.selected {
		border-color: hsl(45, 67%, 74%);
		background: rgba(46, 64, 87, 0.72);
		box-shadow: 0 0 0 1px rgba(238, 239, 183, 0.12);
	}

	.theme-card:disabled {
		opacity: 0.72;
		cursor: not-allowed;
	}

	.swatch {
		position: relative;
		flex-shrink: 0;
		width: 3.25rem;
		height: 3.25rem;
		border-radius: 999px;
		overflow: hidden;
		border: 1px solid rgba(238, 239, 183, 0.22);
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
		gap: 0.35rem;
		min-width: 0;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.title {
		font-family: 'Cinzel Decorative', cursive;
		font-size: 1.05rem;
		color: hsl(45, 67%, 74%);
		letter-spacing: 0.04em;
	}

	.command {
		align-self: flex-start;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		border: 1px solid rgba(238, 239, 183, 0.16);
		background: rgba(0, 0, 0, 0.22);
		color: hsl(45, 67%, 82%);
		font-family: 'Ubuntu Sans Mono', monospace;
		font-size: 0.82rem;
		line-height: 1.4;
		letter-spacing: 0.02em;
	}

	.badge {
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		border: 1px solid rgba(238, 239, 183, 0.28);
		background: rgba(238, 239, 183, 0.08);
		color: hsl(45, 67%, 74%);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.description,
	.status {
		font-size: 0.92rem;
		line-height: 1.55;
		color: rgba(238, 239, 183, 0.82);
	}

	.status {
		color: rgba(238, 239, 183, 0.62);
		font-style: italic;
	}
</style>
