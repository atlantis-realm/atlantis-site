<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

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
				<a href={resolve(link.href)} aria-current={isCurrent(link.href) ? 'page' : undefined}>
					{link.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.main-menu {
		position: absolute;
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
</style>
