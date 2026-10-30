<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
	let { data } = $props();
</script>

<svelte:head>
	<title>{data.post.title} · Atlantis</title>
</svelte:head>

<OceanPage title={data.post.title}>
	{#snippet above()}
		<a href="/blog" class="hud-button hud-button--outline back">← Back to blog</a>
	{/snippet}

	<article class="card hud">
		<p class="hud-meta">
			<span class="hud-meta-author">{data.post.author}_</span>&lt;&lt; {data.post.date.replaceAll(
				'-',
				'.'
			)}
		</p>
		<data.content />
	</article>
</OceanPage>

<style>
	.back {
		align-self: flex-start;
		margin: 0 0 1rem;
	}
</style>
