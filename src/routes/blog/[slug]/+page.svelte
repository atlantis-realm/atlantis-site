<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
	let { data } = $props();
</script>

<svelte:head>
	<title>{data.post.title} · Atlantis</title>
</svelte:head>

<OceanPage title={data.post.title}>
	{#snippet above()}
		<p class="back"><a href="/blog">← Back to blog</a></p>
	{/snippet}

	<article class="card">
		<p>{data.post.author} · {data.post.date}</p>
		{#each data.post.body as paragraph, i (i)}
			<p>{paragraph}</p>
		{/each}
	</article>
</OceanPage>

<style>
	.back {
		margin: 0 0 0.5rem;
	}

	.back a {
		color: #13283f;
	}
</style>
