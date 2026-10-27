<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
	import { blogPosts } from '#lib/content/blogPosts.js';
</script>

<svelte:head>
	<title>Blog · Atlantis</title>
</svelte:head>

<OceanPage title="Blog">
	<section class="card">
		<p>Updates from the guild.</p>
	</section>

	{#each blogPosts as post (post.slug)}
		<article class="card">
			<h2><a href="/blog/{post.slug}">{post.title}</a></h2>
			<p>{post.author} · {post.date}</p>
			<p>{post.excerpt}</p>
		</article>
	{/each}
</OceanPage>
