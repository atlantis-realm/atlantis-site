<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Project, ProjectLink } from '#lib/content/projects.js';
	import ProjectIcon from './ProjectIcon.svelte';

	/*
	 * One project, on the shared .card panel. Projects that need something of their own (extra
	 * formatting, an embed) can pass it as children; it goes between the description and the links.
	 * `class` adds to the panel's own classes (the homepage uses `hud`).
	 */
	let {
		project,
		children,
		class: className
	}: { project: Project; children?: Snippet; class?: string } = $props();

	const external = (link: ProjectLink): boolean => /^https?:/.test(link.href);

	// "Adam, Colin, and Tabs".
	const names = new Intl.ListFormat('en', { type: 'conjunction' });
</script>

{#snippet linkTo(link: ProjectLink, outline: boolean)}
	<a
		href={link.href}
		class={['hud-button', outline && 'hud-button--outline']}
		target={external(link) ? '_blank' : undefined}
		rel={external(link) ? 'noopener noreferrer' : undefined}
	>
		{#if link.icon}<ProjectIcon icon={link.icon} />{/if}
		<span>{link.label}</span>
	</a>
{/snippet}

<article class={['card project', className]}>
	<h3>{project.title}</h3>
	<p>{project.description}</p>

	{#if project.participants.length}
		<p class="participants">With {names.format(project.participants)}</p>
	{:else}
		<p class="participants added">Participants go here.</p>
	{/if}

	{@render children?.()}

	<!-- The project's own link is the filled button; write-ups about it are outlined. -->
	{#if project.link || project.writeups?.length}
		<div class="links">
			{#if project.link}{@render linkTo(project.link, false)}{/if}
			{#each project.writeups ?? [] as writeup (writeup.href)}
				{@render linkTo(writeup, true)}
			{/each}
		</div>
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

	/* Pushed to the bottom, so buttons line up across a row of cards. */
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: auto;
		padding-top: 0.5rem;
	}

	.links a {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		margin: 0;
	}

	/* No circuit traces: inside a card they'd run into the next button or off the panel. */
	.links a::after {
		content: none;
	}
</style>
