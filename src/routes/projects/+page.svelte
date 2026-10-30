<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
	import ProjectCard from '#lib/components/projects/ProjectCard.svelte';
	import { projects } from '#lib/content/projects.js';
</script>

<svelte:head>
	<title>Projects · Atlantis</title>
</svelte:head>

<OceanPage title="Projects">
	<section class="card hud">
		<p>Things guildies are building together.</p>
	</section>

	<section>
		<h2 class="file-label">&lt;&lt; projec.ts</h2>
		<!-- Separate projects, not a sequence: their own cards, side by side. -->
		<div class="projects">
			{#each projects as project (project.title)}
				<ProjectCard {project} class="hud" />
			{/each}
		</div>
	</section>
</OceanPage>

<style>
	.projects {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
		gap: 1.5rem;
	}
</style>
