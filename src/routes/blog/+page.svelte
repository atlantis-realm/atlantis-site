<script lang="ts">
	import { blogPosts } from '$lib/content/blogPosts';
</script>

<svelte:head>
	<title>Blog · Atlantis</title>
</svelte:head>

<main>
	<h1>Blog</h1>
	<p>Updates from the guild.</p>

	<ul>
		{#each blogPosts as post (post.slug)}
			<li>
				<a href="/blog/{post.slug}">{post.title}</a>
				<p>{post.author} · {post.date}</p>
				<p>{post.excerpt}</p>
			</li>
		{/each}
	</ul>
</main>
