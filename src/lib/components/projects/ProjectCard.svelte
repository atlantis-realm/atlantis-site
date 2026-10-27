<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Project, ProjectLink } from '#lib/content/projects.js';
	import ProjectIcon from './ProjectIcon.svelte';

	/*
	 * One project, on the shared .card panel. Projects that need something of their own (extra
	 * formatting, an embed) can pass it as children; it goes between the description and the links.
	 */
	let { project, children }: { project: Project; children?: Snippet } = $props();

	const external = (link: ProjectLink): boolean => /^https?:/.test(link.href);
</script>

{#snippet linkTo(link: ProjectLink)}
	<a
		href={link.href}
		target={external(link) ? '_blank' : undefined}
		rel={external(link) ? 'noopener noreferrer' : undefined}
	>
		{#if link.icon}<ProjectIcon icon={link.icon} />{/if}
		<span>{link.label}</span>
	</a>
{/snippet}

<article class="card project">
	<h3>{project.title}</h3>
	<p>{project.description}</p>

	{#if project.participants.length}
		<p class="participants">With {project.participants.join(', ')}</p>
	{:else}
		<p class="participants added">Participants go here.</p>
	{/if}

	{@render children?.()}

	{#if project.writeups?.length}
		<ul class="writeups">
			{#each project.writeups as writeup (writeup.href)}
				<li>{@render linkTo(writeup)}</li>
			{/each}
		</ul>
	{/if}

	{#if project.link}
		<p class="project-link">{@render linkTo(project.link)}</p>
	{/if}
</article>

<style>
	.project {
		display: flex;
		flex-direction: column;
	}

	.participants {
		font-size: 0.9em;
		opacity: 0.75;
	}

	.writeups {
		margin: 0 0 1rem;
		padding-left: 1.2rem;
	}

	/* Push the project's own link to the bottom, so links line up across a row of cards. */
	.project-link {
		margin-top: auto;
		padding-top: 0.5rem;
	}

	a {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
	}
</style>
