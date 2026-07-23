<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>{data.post.title} · Atlantis</title>
</svelte:head>

<main>
	<p><a href="/blog">← Back to blog</a></p>
	<h1>{data.post.title}</h1>
	<p>{data.post.author} · {data.post.date}</p>

	{#each data.post.body as paragraph}
		<p>{paragraph}</p>
	{/each}
</main>
