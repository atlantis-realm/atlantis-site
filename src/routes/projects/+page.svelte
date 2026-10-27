<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
	import ProjectCard from '#lib/components/projects/ProjectCard.svelte';
	import { projects } from '#lib/content/projects.js';
</script>

<svelte:head>
	<title>Projects · Atlantis</title>
</svelte:head>

<OceanPage title="Projects">
	<section class="card">
		<p>Things guildies are building together.</p>
	</section>

	<div class="projects">
		{#each projects as project (project.title)}
			<ProjectCard {project} />
		{/each}
	</div>
</OceanPage>

<style>
	.projects {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: 1.5rem;
	}
</style>
