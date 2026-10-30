<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
	import { blogPosts } from '#lib/content/blogPosts.js';
</script>

<svelte:head>
	<title>Blog · Atlantis</title>
</svelte:head>

<OceanPage title="Blog">
	<section class="card hud">
		<p>Updates from the guild.</p>
	</section>

	<section>
		<h2 class="file-label">&lt;&lt; pos.ts</h2>
		<!-- Posts run in order, so they're banded together. -->
		<ul class="hud-band hud-band--column">
			{#each blogPosts as post (post.slug)}
				<li>
					<p class="hud-meta">
						<span class="hud-meta-author">{post.author}_</span>&lt;&lt; {post.date.replaceAll(
							'-',
							'.'
						)}
					</p>
					<h3><a href="/blog/{post.slug}">{post.title}</a></h3>
					<p>{post.excerpt}</p>
				</li>
			{/each}
		</ul>
	</section>
</OceanPage>
