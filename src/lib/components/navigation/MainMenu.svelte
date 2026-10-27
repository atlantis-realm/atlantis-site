<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { wave } from '#lib/actions/wave.js';

	const links = [
		{ href: '/', label: 'Home' },
		{ href: '/about', label: 'About' },
		{ href: '/events', label: 'Events' },
		{ href: '/blog', label: 'Blog' },
		{ href: '/roadmap', label: 'Roadmap' },
		{ href: '/ladyofcode/dice-themes', label: 'Dice Themes' }
	] as const;

	function isCurrent(href: string) {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}
</script>

<nav class="main-menu" aria-label="Main menu">
	<ul>
		{#each links as link (link.href)}
			<li>
				<a
					href={resolve(link.href)}
					aria-current={isCurrent(link.href) ? 'page' : undefined}
					use:wave={link.label}
				>
					{link.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	/* Fixed, so the menu stays in the top corner as the page scrolls. */
	.main-menu {
		position: fixed;
		top: 0;
		right: 0;
		z-index: 10;
		padding: 1rem;
	}

	ul {
		display: flex;
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li{
		position: relative;
	}

	a{
		display: inline-block;
		padding: .5rem 1rem;
		text-decoration: none;
		color: var(--nav-color);
	}
</style>
