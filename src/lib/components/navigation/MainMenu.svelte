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
				<a href={resolve(link.href)} aria-label={link.label} aria-current={isCurrent(link.href) ? 'page' : undefined}>
					{#each [...link.label] as char, i }
						<span class="nav__char" style="--i: {i}">{char === ' '? '\u00A0' : char}</span>
					{/each}
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

	li{
		position: relative;
	}

	a{
		display: inline-block;
		padding: .5rem 1rem;
		text-decoration: none;
		color: var(--nav-color);
	}

	.nav__char{
		display: inline-block;
	}

	a:hover .nav__char{
		animation: wave 2s infinite;
		animation-delay: calc(var(--i) * 120ms);
	}

	@keyframes wave{
		0% 				{ transform: translateY(0); animation-timing-function: ease-out;}
		33%           	{ transform: translateY(-.4rem); animation-timing-function: ease-in-out;}
		66% 			{ transform: translateY(.6rem); animation-timing-function: ease-in;}
		100%			{ transform: translateY(0)}
	}
</style>
