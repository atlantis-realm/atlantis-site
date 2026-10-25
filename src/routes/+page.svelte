<script lang="ts">
	import { blogPosts } from '#lib/content/blogPosts.js';
	import { upcomingEvents } from '#lib/content/events.js';

	const [featuredPost, ...otherPosts] = [...blogPosts].sort((a, b) => b.date.localeCompare(a.date));
	const smallPosts = otherPosts.slice(0, 4);

	// Placeholder slots until there's a member list to pull icons from.
	const memberSlots = Array.from({ length: 12 }, (_, index) => index);
</script>

<video autoplay muted loop id="myVideo">
	<source src="background.m4v" type="video/mp4" />
	Your browser does not support HTML5 video.
</video>
<div id="container">
	<svg viewBox="0 0 100 80">
		<text x="52%" y="55%" text-anchor="middle"> Atlantis </text>
	</svg>
</div>

<section id="community-section">
	<div class="content-wrapper">
		<p class="intro">
			Atlantis is a community of high effort builders, bringing together nerds from around the world in tech, design, arts, and more.
		</p>
		<p class="intro">We approach our crafts and each other with XXX.</p>
		<p class="tagline">Think MMORPG vibes, but tech.</p>
		<p class="added">
			<span class="text-link">See us doing stuff in person</span> — link to a video or photo gallery.
		</p>

		<div class="divider"></div>

		<h2>News</h2>
		{#if featuredPost}
			<div class="news-grid">
				<a href="/blog/{featuredPost.slug}" class="news-card news-card--main">
					{#if featuredPost.image}
						<img src={featuredPost.image} alt="" />
					{:else}
						<div class="image-placeholder added">Featured image</div>
					{/if}
					<h3>{featuredPost.title}</h3>
					<p class="news-meta">{featuredPost.author} · {featuredPost.date}</p>
					<p>{featuredPost.excerpt}</p>
				</a>
				<div class="news-small">
					{#each smallPosts as post (post.slug)}
						<a href="/blog/{post.slug}" class="news-card">
							{#if post.image}
								<img src={post.image} alt="" />
							{:else}
								<div class="image-placeholder added">Image</div>
							{/if}
							<h3>{post.title}</h3>
							<p class="news-meta">{post.author} · {post.date}</p>
						</a>
					{/each}
				</div>
			</div>
		{/if}
		<p class="added"><a href="/blog" class="text-link">All news</a></p>

		<div class="divider"></div>

		<h2>Events</h2>
		<ul class="event-list">
			{#each upcomingEvents as event (event.name)}
				<li><strong>{event.name}:</strong> {event.description}</li>
			{/each}
			<li class="added"><strong>Streams:</strong> next stream times and links go here.</li>
		</ul>
		<p class="added"><a href="/events" class="text-link">All events and streams</a></p>

		<div class="divider"></div>

		<h2>Community projects</h2>
		<div class="project-grid">
			<div class="project-card">
				<p>We're creating a collective mood board to define our design language direction... And brainstorm ideas for visualising Atlantis as an actual city.</p>
			</div>
			<div class="project-card">
				<p>We're also starting a collaborative playlist to share favourite songs with each other. :D</p>
			</div>
			<div class="project-card">
				<p>
					<a href="/ladyofcode/dice-themes" class="text-link">Browse stream dice themes</a>
					— preview materials and grab the <code>!dicethemes</code> chat command for each one.
				</p>
			</div>
		</div>

		<div class="divider"></div>

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

		<h3>What are we like?</h3>
		<p>
			Everyone approaches their craft with love and a huge amount of effort. Guildies are from around the world, so expect a bunch of different cultures and personalities. The vibe is generally easygoing, littered with puns and terrible jokes.
		</p>
		<p class="reassurance">
			Atlantis is chaos only a portion of the time, we promise &lt;3
		</p>
		<p class="age-note">18+ only</p>

		<a href="https://discord.com/invite/4gQAndh" target="_blank" rel="noopener noreferrer" class="discord-button">
			Join us on Discord
		</a>
	</div>
</section>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&display=swap');
	@import url('https://fonts.googleapis.com/css2?family=Ubuntu+Sans+Mono:wght@400;500;600;700&display=swap');

	video {
		object-fit: cover;
		width: 100vw;
		height: 100vh;
		position: absolute;
		top: 0;
		left: 0;
	}

	#container {
		position: relative;
		height: 100vh;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	svg {
		width: 100%;
	}

	svg text {
		font-family: 'Cinzel Decorative', cursive;
		letter-spacing: 2px;
		stroke: #eeefb7;
		font-size: 1em;
		font-weight: 900;
		stroke-width: 0.24;
		animation: textAnimate 5s infinite alternate;
	}

	@keyframes textAnimate {
		0% {
			stroke-dasharray: 0 50%;
			stroke-dashoffset: 20%;
			fill: hsl(45, 67%, 74%);
		}

		100% {
			stroke-dasharray: 50% 0;
			stroke-dashoffstet: -20%;
			fill: rgba(8, 107, 125, 0.666);
		}
	}

	#community-section {
		position: relative;
		min-height: 100vh;
		background: linear-gradient(to bottom, #2e4057 0%, #1a2838 100%);
		padding: 80px 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #eeefb7;
		z-index: 1;
		font-family: 'Ubuntu Sans Mono', monospace;
	}

	/* Square dots on a grid with a slowly pulsing glow, layered over the gradient.
	   ::before draws the dots, ::after draws a blurred copy as the glow. */
	#community-section {
		--dot-size: 2px;
		--dot-color: hsl(45, 67%, 74%);
		--dot-glow-color: hsl(45, 67%, 74%);
		--dot-spacing: 100px;
	}

	#community-section::before,
	#community-section::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background-image: conic-gradient(
			from 270deg at var(--dot-size) var(--dot-size),
			var(--dot-layer-color) 25%,
			transparent 0
		);
		background-size: var(--dot-spacing) var(--dot-spacing);
		background-position: calc((var(--dot-spacing) - var(--dot-size)) / 2)
			calc((var(--dot-spacing) - var(--dot-size)) / 2);
	}

	#community-section::before {
		--dot-layer-color: var(--dot-color);
		z-index: -1;
	}

	#community-section::after {
		--dot-layer-color: var(--dot-glow-color);
		z-index: -2;
		filter: blur(4px);
		animation: dotGlow 8s ease-in-out infinite;
	}

	@keyframes dotGlow {
		0%,
		100% {
			opacity: 0.1;
		}

		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		#community-section::after {
			animation: none;
			opacity: 0.5;
		}
	}

	.content-wrapper {
		max-width: 800px;
		width: 100%;
		text-align: center;
	}

	.intro {
		font-size: 1.5rem;
		line-height: 1.8;
		margin-bottom: 1rem;
		color: hsl(45, 67%, 74%);
	}

	.tagline {
		font-size: 1.2rem;
		font-style: italic;
		margin-bottom: 3rem;
		color: rgba(238, 239, 183, 0.8);
	}

	.divider {
		width: 100px;
		height: 2px;
		background: linear-gradient(
			to right,
			transparent,
			hsl(45, 67%, 74%),
			transparent
		);
		margin: 3rem auto;
	}

	h2 {
		font-family: 'Cinzel Decorative', cursive;
		font-size: 2rem;
		margin-bottom: 2rem;
		color: hsl(45, 67%, 74%);
		letter-spacing: 1px;
	}

	#community-section p {
		font-size: 1.1rem;
		line-height: 1.8;
		margin-bottom: 1.5rem;
		color: rgba(238, 239, 183, 0.9);
	}

	.reassurance {
		font-size: 1.2rem;
		margin-top: 2rem;
		color: rgba(8, 107, 125, 0.8);
		font-style: italic;
	}

	.discord-button {
		display: inline-block;
		margin: 3rem auto;
		padding: 16px 40px;
		background: linear-gradient(135deg, hsl(45, 67%, 80%) 0%, hsl(45, 67%, 68%) 100%);
		color: #1a2838;
		text-decoration: none;
		font-family: 'Ubuntu Sans Mono', monospace;
		font-size: 1.2rem;
		font-weight: 600;
		border-radius: 8px;
		transition: all 0.3s ease;
		box-shadow: 0 4px 15px hsla(45, 67%, 74%, 0.4);
		letter-spacing: 0.5px;
	}

	.discord-button:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 20px hsla(45, 67%, 74%, 0.6);
		background: linear-gradient(135deg, hsl(45, 67%, 76%) 0%, hsl(45, 67%, 64%) 100%);
	}

	.discord-button:active {
		transform: translateY(0);
		box-shadow: 0 2px 10px hsla(45, 67%, 74%, 0.4);
	}

	.text-link {
		color: hsl(45, 67%, 74%);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 0.18em;
	}

	.text-link:hover {
		color: hsl(45, 67%, 82%);
	}

	h3 {
		font-size: 1.2rem;
		margin: 2rem 0 1rem;
		color: hsl(45, 67%, 74%);
	}

	.news-grid {
		display: grid;
		grid-template-columns: 3fr 2fr;
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
		display: block;
		padding: 0.75rem;
		border-radius: 8px;
		background: #243448;
		color: inherit;
		text-decoration: none;
		transition: background 0.2s ease;
	}

	.news-card:hover {
		background: #1d2b3c;
	}

	.news-card img,
	.image-placeholder {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 6px;
	}

	.image-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #1d4a5d;
		color: rgba(238, 239, 183, 0.7);
	}

	.news-card h3 {
		margin: 0.75rem 0 0.25rem;
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
		font-size: 0.85rem;
		color: rgba(238, 239, 183, 0.6);
	}

	.event-list {
		list-style: none;
		padding: 0;
		text-align: left;
		line-height: 1.8;
	}

	.event-list li {
		margin-bottom: 0.75rem;
	}

	.project-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		text-align: left;
	}

	.project-card {
		padding: 1rem;
		border-radius: 8px;
		background: #243448;
	}

	#community-section .project-card p {
		margin: 0;
	}

	.member-grid {
		list-style: none;
		padding: 0;
		margin: 0 auto;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
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
	}

	#community-section code {
		font-size: 0.95em;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		background: #223245;
	}

	@media (max-width: 768px) {
		.news-grid,
		.project-grid {
			grid-template-columns: 1fr;
		}

		.intro {
			font-size: 1.2rem;
		}

		.tagline {
			font-size: 1rem;
		}

		h2 {
			font-size: 1.5rem;
		}

		#community-section p {
			font-size: 1rem;
		}

		.discord-button {
			padding: 14px 32px;
			font-size: 1.1rem;
		}
	}
</style>
