<script lang="ts">
	import { onMount } from 'svelte';
	import type { HomeScene } from '#lib/home/HomeScene.js';
	import type { CityHeroMode } from '#lib/city/CityHeroScene.js';
	import { readMode, saveMode } from '#lib/city/mode.js';
	import { blogPosts, type BlogPost } from '#lib/content/blogPosts.js';
	import { upcomingEvents } from '#lib/content/events.js';
	import { projects } from '#lib/content/projects.js';
	import ProjectCard from '#lib/components/projects/ProjectCard.svelte';
	import HoloEarth from '#lib/components/HoloEarth.svelte';
	import NeonObject from '#lib/components/NeonObject.svelte';
	import type { NeonObjectKind } from '#lib/objects/NeonObjects.js';
	import { drift } from '#lib/actions/drift.js';
	import { getLoadingTracker } from '#lib/loading.svelte.js';

	const [featuredPost, ...otherPosts] = [...blogPosts].sort((a, b) => b.date.localeCompare(a.date));
	const smallPosts = otherPosts.slice(0, 4);

	const BARCODE_BARS = 7;

	function barcodeFor(slug: string) {
		let hash = 2166136261;
		const bars: { x: number; width: number }[] = [];
		let x = 0;
		for (let i = 0; i < BARCODE_BARS; i++) {
			hash = Math.imul(hash ^ slug.charCodeAt(i % slug.length), 16777619) ^ i;
			const width = 1 + ((hash >>> 3) % 3);
			bars.push({ x, width });
			x += width + 1 + ((hash >>> 7) % 2);
		}
		return { bars, width: x };
	}

	const projectObjects: Record<string, NeonObjectKind> = {
		'Design jam': 'iridescentD20',
		Syrenware: 'angler'
	};

	const homeProjects = projects.filter((project) => project.title !== 'Stream dice themes');

	const memberSlots = Array.from({ length: 12 }, (_, index) => index);

	const STREAM_DAYS = [2, 4];
	const STREAM_END_HOUR = 9.5;
	const HOUR_MS = 60 * 60 * 1000;

	function nextStreamDates(count: number, now = new Date()) {
		const nowGmtPlus1 = now.getTime() + HOUR_MS;
		const today = new Date(nowGmtPlus1);
		const streams: string[] = [];

		for (let offset = 0; streams.length < count; offset++) {
			const day = new Date(
				Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset)
			);
			if (!STREAM_DAYS.includes(day.getUTCDay())) continue;
			if (day.getTime() + STREAM_END_HOUR * HOUR_MS <= nowGmtPlus1) continue;

			streams.push(
				day.toLocaleDateString('en-GB', {
					weekday: 'short',
					day: 'numeric',
					month: 'short',
					timeZone: 'UTC'
				})
			);
		}

		return streams;
	}

	const upcomingStreams = nextStreamDates(2);

	const eventCards = [
		...upcomingEvents.map((event) => ({
			...event,
			href: '/events',
			action: 'Details',
			external: false,
			placeholder: false
		})),
		{
			name: 'Streams',
			description: `${upcomingStreams.join(' and ')}, 6:30am–9:30am GMT+1`,
			image: undefined,
			href: 'https://www.twitch.tv/ladyofcode',
			action: 'Watch on Twitch',
			external: true,
			placeholder: true
		}
	];

	const INTRO_SCREENS = 5;

	let canvas: HTMLCanvasElement | undefined = $state();
	let track: HTMLDivElement | undefined = $state();
	let scene: HomeScene | undefined;
	let mode: CityHeroMode = $state('day');

	function toggleMode(): void {
		mode = mode === 'night' ? 'day' : 'night';
		saveMode(mode);
		scene?.setMode(mode);
	}

	const loading = getLoadingTracker();

	function syncScroll(): void {
		const intro = track?.offsetHeight ?? INTRO_SCREENS * window.innerHeight;
		const rest = document.documentElement.scrollHeight - window.innerHeight - intro;
		const scrolled = window.scrollY;
		scene?.setProgress(scrolled / intro, rest > 0 ? (scrolled - intro) / rest : 0);
	}

	onMount(() => {
		if (!canvas) return;
		mode = readMode();

		let observer: ResizeObserver | undefined;
		let unmounted = false;

		const ready = import('#lib/home/HomeScene.js').then(({ HomeScene }) => {
			if (unmounted || !canvas) return;

			const home = new HomeScene(canvas);
			scene = home;
			home.setMode(mode);
			if (import.meta.env.DEV) (window as unknown as { __home?: HomeScene }).__home = home;
			syncScroll();
			observer = new ResizeObserver(() => scene?.resize());
			observer.observe(canvas);
			return home.load().then(() => home.warmUp());
		});
		ready.catch((err) => console.warn('Home scene: not fully loaded.', err));
		loading?.track(ready);

		return () => {
			unmounted = true;
			observer?.disconnect();
			scene?.destroy();
			scene = undefined;
		};
	});
</script>

<svelte:window onscroll={syncScroll} onresize={syncScroll} />

<div class="scene-stage">
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>
<div class="scene-track" style:--intro-screens={INTRO_SCREENS} bind:this={track}></div>
<button
	type="button"
	class="mode"
	class:night={mode === 'night'}
	aria-pressed={mode === 'night'}
	onclick={toggleMode}
>
	Night
</button>

{#snippet newsMeta(post: BlogPost)}
	{@const barcode = barcodeFor(post.slug)}
	<p class="news-meta">
		<span class="news-author">{post.author}_</span>
		<span class="news-date">&lt;&lt; {post.date.replaceAll('-', '.')}</span>
		<svg class="news-barcode" viewBox="0 0 {barcode.width} 10" aria-hidden="true">
			{#each barcode.bars as bar (bar.x)}
				<rect x={bar.x} width={bar.width} height="10" />
			{/each}
		</svg>
	</p>
{/snippet}

<section id="community-section">
	<div class="content-wrapper">
		<div class="subsection-container intro">
			<div class="card hud intro__card" use:drift>
				<h2>MMORPG guild vibes, but for nerds</h2>
				<p class="intro__text">
					Atlantis is a community of high effort builders, bringing together nerds from around the
					world in tech, design, arts, and more.
				</p>
				<p class="intro__text">We approach our crafts and each other with XXX.</p>
				<a
					href="https://discord.com/invite/4gQAndh"
					target="_blank"
					rel="noopener noreferrer"
					class="hud-button"
				>
					Join us on Discord
				</a>
			</div>

			<div class="intro__media" use:drift={1.3}>
				<HoloEarth />
			</div>
		</div>

		<div class="news" use:drift={0.85}>
			<p class="file-label">&lt;&lt; news_highligh.ts</p>
			{#if featuredPost}
				<div class="news-grid">
					<a href="/blog/{featuredPost.slug}" class="news-card news-card--main">
						{#if featuredPost.image}
							<img src={featuredPost.image} alt="" />
						{:else}
							<div class="image-placeholder added">Featured image</div>
						{/if}
						{@render newsMeta(featuredPost)}
						<div class="news-body">
							<h3>{featuredPost.title}</h3>
							<p>{featuredPost.excerpt}</p>
						</div>
					</a>
					<div class="news-small">
						{#each smallPosts as post (post.slug)}
							<a href="/blog/{post.slug}" class="news-card">
								{#if post.image}
									<img src={post.image} alt="" />
								{:else}
									<div class="image-placeholder added">Image</div>
								{/if}
								{@render newsMeta(post)}
								<div class="news-body">
									<h3>{post.title}</h3>
									<p>{post.excerpt}</p>
								</div>
							</a>
						{/each}
					</div>
				</div>
			{/if}
			<a href="/blog" class="hud-button hud-button--outline">All news</a>
		</div>

		<div class="events" use:drift={1.1}>
			<p class="file-label">&lt;&lt; even.ts</p>
			<ul class="event-strip">
				{#each eventCards as event (event.name)}
					<li class="event-panel">
						{#if event.image}
							<img src={event.image} alt="" />
						{:else}
							<div class="image-placeholder added">Event image</div>
						{/if}
						<h3>{event.name}</h3>
						<p class:added={event.placeholder}>{event.description}</p>
						<a
							href={event.href}
							class="hud-button hud-button--outline"
							target={event.external ? '_blank' : undefined}
							rel={event.external ? 'noopener noreferrer' : undefined}>{event.action}</a
						>
					</li>
				{/each}
			</ul>
			<a href="/events" class="hud-button hud-button--outline">All events and streams</a>
		</div>

		<div class="projects">
			<p class="file-label">&lt;&lt; projec.ts</p>
			{#each homeProjects as project, index (project.title)}
				<div class="intro project-row" class:project-row--flipped={index % 2 === 1}>
					<div class="intro__card" use:drift={0.9 + (index % 2) * 0.2}>
						<ProjectCard {project} class="hud" />
					</div>
					<div class="intro__media" use:drift={1.3 - (index % 2) * 0.2}>
						{#if projectObjects[project.title]}
							<NeonObject kind={projectObjects[project.title]} />
						{/if}
					</div>
				</div>
			{/each}
			<a href="/projects" class="hud-button hud-button--outline">All projects</a>
		</div>

		<div class="subsection-container">
			<div class="card hud" use:drift={1.05}>
				<h2>Join Atlantis</h2>
				<h3 class="added">Who you'll be joining</h3>
				<ul class="member-grid" aria-label="Members">
					{#each memberSlots as slot (slot)}
						<li class="member-icon"></li>
					{/each}
				</ul>
				<p class="added member-note">
					Member icons go here. Members without an icon get a generated default Atlantis symbol.
				</p>

				<p class="age-note">18+ only</p>

				<a
					href="https://discord.com/invite/4gQAndh"
					target="_blank"
					rel="noopener noreferrer"
					class="hud-button"
				>
					Join us on Discord
				</a>
			</div>
		</div>
	</div>
</section>

<style>
	.scene-stage {
		position: fixed;
		inset: 0;
		z-index: -1;
		background: #000;
	}

	.scene-stage canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.scene-track {
		height: calc(var(--intro-screens) * 100vh);
	}

	.mode {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 2;
		padding: 0.5rem 1rem;
		border: 1px solid rgb(255 255 255 / 0.6);
		border-radius: 999px;
		background: rgb(20 30 50 / 0.55);
		color: #fff;
		font: inherit;
		cursor: pointer;
		backdrop-filter: blur(4px);
	}

	.mode.night {
		background: rgb(255 214 150 / 0.85);
		color: #1a1a2e;
	}

	.mode:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	#community-section {
		position: relative;
		min-height: 100vh;
		padding: 80px 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1;
		font-family: 'Ubuntu Sans Mono Variable', monospace;
		color: var(--hud-text);
	}

	.content-wrapper {
		width: 100%;
		text-align: left;
	}

	#community-section :global(.card) {
		color: var(--hud-text);
	}

	#community-section :global(.card h2),
	#community-section :global(.card h3) {
		color: var(--hud-heading);
	}

	.subsection-container {
		min-height: 80vh;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.intro {
		flex-direction: row;
		align-items: center;
		gap: 2rem;
		width: 100%;
		max-width: 75rem;
		margin-inline: auto;
	}

	.intro__card {
		flex: 0 1 26rem;
	}

	.intro__media {
		flex: 1;
		max-width: 36rem;
		margin-inline: auto;
	}

	.content-wrapper > * + * {
		margin-top: clamp(10rem, 35vh, 20rem);
	}

	h2 {
		font-size: 1.9rem;
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--hud-heading);
		margin-bottom: 1.5rem;
	}

	h2::after {
		content: '';
		display: block;
		width: 3rem;
		height: 3px;
		margin-top: 1rem;
		background: var(--hud-accent);
	}

	#community-section p {
		font-size: 1.05rem;
		line-height: 1.6;
		margin-bottom: 1rem;
		color: var(--hud-text);
	}

	#community-section .file-label {
		margin: 0 0 1rem;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		color: var(--hud-accent);
	}

	h3 {
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		margin: 2rem 0 1rem;
		color: var(--hud-heading);
	}

	.news-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		text-align: left;
	}

	.news-small {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		align-content: start;
	}

	.news-card {
		position: relative;
		isolation: isolate;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 1rem;
		min-height: 12rem;
		padding: 0.75rem;
		overflow: hidden;
		border-radius: 8px;
		background: #243448;
		color: inherit;
		text-decoration: none;
		transition: background 0.2s ease;
	}
	.news-small .news-card:nth-child(1) {
		clip-path: polygon(100% 0, 100% 5%, 100% 100%, 0 100%, 0 5%, 5% 0);
	}
	.news-small .news-card:nth-child(2) {
		clip-path: polygon(95% 0, 100% 5%, 100% 100%, 0 100%, 0 0, 20% 0);
	}
	.news-small .news-card:nth-child(3) {
		clip-path: polygon(0 0, 100% 0, 100% 100%, 5% 100%, 0 95%, 0% 50%);
	}
	.news-small .news-card:nth-child(4) {
		clip-path: polygon(0 0, 100% 0, 100% 95%, 95% 100%, 0 100%, 0% 50%);
	}

	.news-card--main {
		clip-path: polygon(0 0, 100% 0, 100% 95%, 95% 100%, 0 100%, 0% 50%);
	}
	.news-card:hover {
		background: #1d2b3c;
	}

	.news-card img,
	.image-placeholder {
		position: absolute;
		inset: 0;
		z-index: -2;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.news-card::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			linear-gradient(to top, rgb(10 16 26 / 0.9), rgb(10 16 26 / 0.2) 60%, transparent),
			linear-gradient(to bottom left, rgb(10 16 26 / 0.7), transparent 40%);
	}

	.news-body {
		text-align: left;
	}

	#community-section .news-small .news-body p {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.image-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #1d4a5d;
		color: var(--hud-dim);
	}

	.news-card h3 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}

	.news-card--main h3 {
		font-size: 1.4rem;
	}

	#community-section .news-card p {
		font-size: 0.95rem;
		line-height: 1.5;
		margin-bottom: 0.5rem;
	}

	#community-section .news-meta {
		align-self: flex-end;
		display: flex;
		align-items: center;
		gap: 0.6em;
		margin: 0;
		font-size: 0.85rem;
		line-height: 1;
		color: var(--hud-dim);
	}

	.news-author {
		color: var(--hud-accent);
		font-weight: 600;
	}

	.news-barcode {
		height: 0.75em;
		width: auto;
		fill: currentColor;
	}

	.event-strip {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 4px;
		clip-path: polygon(
			28px 0,
			100% 0,
			100% calc(100% - 28px),
			calc(100% - 28px) 100%,
			0 100%,
			0 28px
		);
	}

	.event-panel {
		position: relative;
		isolation: isolate;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		min-height: 32rem;
		padding: 1.5rem;
		overflow: hidden;
	}

	.event-panel img {
		position: absolute;
		inset: 0;
		z-index: -2;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.event-panel::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: linear-gradient(
			to top,
			rgb(6 14 24 / 0.95),
			rgb(6 14 24 / 0.6) 40%,
			transparent 70%
		);
	}

	#community-section .event-panel h3 {
		margin: 0 0 0.5rem;
		font-size: 1.3rem;
	}

	#community-section .event-panel p {
		margin-bottom: 0;
	}

	#community-section .event-panel .hud-button {
		align-self: flex-start;
		margin: 1.5rem 0 0;
	}

	#community-section .event-panel .hud-button::after {
		content: none;
	}

	.projects {
		max-width: 75rem;
		margin-inline: auto;
	}

	.project-row {
		display: flex;
	}

	.project-row + .project-row {
		margin-top: clamp(10rem, 40vh, 20rem);
	}

	.project-row--flipped {
		flex-direction: row-reverse;
	}

	.member-grid {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.member-icon {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: linear-gradient(135deg, #086b7d, #2e4057, hsl(45, 67%, 74%), #086b7d);
		background-size: 300% 300%;
		animation: water 8s ease-in-out infinite;
	}

	.member-icon:nth-child(3n) {
		animation-delay: -2s;
	}

	.member-icon:nth-child(3n + 1) {
		animation-delay: -5s;
	}

	@keyframes water {
		0%,
		100% {
			background-position: 0% 50%;
		}

		50% {
			background-position: 100% 50%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.member-icon {
			animation: none;
		}
	}

	#community-section .member-note {
		font-size: 0.95rem;
		margin-top: 1rem;
	}

	#community-section .age-note {
		font-weight: 600;
		margin-top: 1rem;
		color: var(--hud-dim);
	}

	@media (max-width: 768px) {
		.news-grid {
			grid-template-columns: 1fr;
		}

		.project-row--flipped {
			flex-direction: column;
		}

		.intro {
			flex-direction: column;
			align-items: stretch;
		}

		.intro__card {
			flex: none;
		}

		h2 {
			font-size: 1.5rem;
		}

		#community-section p {
			font-size: 1rem;
		}
	}
</style>
