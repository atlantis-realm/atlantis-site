<script lang="ts">
	import { resolve } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';

	const DISCORD_INVITE = 'https://discord.com/invite/4gQAndh';

	// Entries with `children` are drop-downs.
	const links = [
		{ href: '/', label: 'Home' },
		{ href: '/about', label: 'About' },
		{ href: '/events', label: 'Events' },
		{ href: '/blog', label: 'Blog' },
		{ href: '/roadmap', label: 'Roadmap' },
		{ label: 'Rewards', children: [{ href: '/ladyofcode/dice-themes', label: 'Dice Themes' }] }
	] as const;

	function isCurrent(href: string) {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}

	// The open drop-down, by label. It opens while a mouse is over it, and on click or tap; it
	// closes on Escape, a click anywhere else, or moving to another page.
	let openMenu: string | null = $state(null);
	let hovering = false;
	let nav: HTMLElement | undefined = $state();

	afterNavigate(() => (openMenu = null));

	function onToggle(label: string): void {
		// Already opened by the mouse being over it, so a click shouldn't shut it again.
		if (hovering) openMenu = label;
		else openMenu = openMenu === label ? null : label;
	}

	function onPointerEnter(event: PointerEvent, label: string): void {
		if (event.pointerType !== 'mouse') return;
		hovering = true;
		openMenu = label;
	}

	function onPointerLeave(event: PointerEvent, label: string): void {
		if (event.pointerType !== 'mouse') return;
		hovering = false;
		if (openMenu === label) openMenu = null;
	}

	function onWindowClick(event: MouseEvent): void {
		if (nav && !nav.contains(event.target as Node)) openMenu = null;
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') openMenu = null;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<nav class="main-menu" aria-label="Main menu" bind:this={nav}>
	<div class="bar">
		<!-- The HUD panel is its own layer: its clip-path would cut off a drop-down inside it. -->
		<div class="hud panel" aria-hidden="true"></div>
		<ul>
			{#each links as link (link.label)}
				{#if 'children' in link}
					{@const current = link.children.some((child) => isCurrent(child.href))}
					{@const open = openMenu === link.label}
					<li
						class="group"
						onpointerenter={(event) => onPointerEnter(event, link.label)}
						onpointerleave={(event) => onPointerLeave(event, link.label)}
					>
						<button
							type="button"
							class="item"
							class:current
							aria-expanded={open}
							aria-controls="menu-{link.label}"
							onclick={() => onToggle(link.label)}
						>
							{link.label}<span class="caret" class:open aria-hidden="true"></span>
						</button>
						<!-- Padded down from the bar rather than spaced, so the mouse can cross the gap. -->
						<div class="dropdown" id="menu-{link.label}" hidden={!open}>
							<ul class="hud submenu">
								{#each link.children as child (child.href)}
									<li>
										<a
											class="item"
											href={resolve(child.href)}
											aria-current={isCurrent(child.href) ? 'page' : undefined}
										>
											{child.label}
										</a>
									</li>
								{/each}
							</ul>
						</div>
					</li>
				{:else}
					<li>
						<a
							class="item"
							href={resolve(link.href)}
							aria-current={isCurrent(link.href) ? 'page' : undefined}
						>
							{link.label}
						</a>
					</li>
				{/if}
			{/each}
			<li class="join">
				<a class="hud-button" href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer">
					Join
				</a>
			</li>
		</ul>
	</div>
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

	.bar {
		position: relative;
		isolation: isolate;
	}

	/* The homepage's HUD panel (see .hud in app.css), with a smaller bevel and frame to suit a bar. */
	.panel {
		position: absolute;
		inset: 0;
		z-index: -1;
		padding: 0;
		--hud-bevel: 14px;
		--hud-frame: 2px;
	}

	.bar > ul {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
		margin: 0;
		padding: 0.35rem 1rem;
		list-style: none;
	}

	li {
		position: relative;
	}

	/* Hard uppercase mono, tracked out, like the homepage's buttons and file labels. */
	.item {
		position: relative;
		display: inline-flex;
		align-items: center;
		padding: 0.5rem 0.75rem;
		border: 0;
		background: none;
		font-family: 'Ubuntu Sans Mono Variable', monospace;
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--nav-color);
		cursor: pointer;
		transition: color 0.2s ease;
	}

	.item:hover,
	.item[aria-current='page'],
	.item.current,
	.item[aria-expanded='true'] {
		color: hsl(185, 90%, 60%);
	}

	/* The current page gets the short cyan rule the homepage puts under its headings. */
	.item[aria-current='page']::after,
	.item.current::after {
		content: '';
		position: absolute;
		left: 0.75rem;
		bottom: 0.2rem;
		width: 1.5rem;
		height: 2px;
		background: hsl(185, 90%, 60%);
	}

	.caret {
		width: 0.4em;
		height: 0.4em;
		margin-left: 0.6em;
		border-right: 2px solid currentColor;
		border-bottom: 2px solid currentColor;
		transform: translateY(-25%) rotate(45deg);
		transition: transform 0.2s ease;
	}

	.caret.open {
		transform: translateY(25%) rotate(225deg);
	}

	.dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		padding-top: 0.6rem;
	}

	/* A small HUD panel of its own, more opaque than the bar so it reads over the page. */
	.submenu {
		--hud-bevel: 10px;
		--hud-frame: 2px;
		min-width: max-content;
		margin: 0;
		padding: 0.4rem 0.6rem;
		list-style: none;
		background: rgb(6 18 30 / 0.92);
	}

	/* The homepage's filled cyan button (see .hud-button in app.css), sized down for the bar. */
	.join {
		margin-left: 0.5rem;
	}

	.join a {
		margin: 0;
		padding: 0.45rem 1.1rem;
		font-size: 0.8rem;
	}

	.join a::after {
		content: none;
	}
</style>
