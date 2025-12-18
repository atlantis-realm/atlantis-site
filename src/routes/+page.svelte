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
			Atlantis is a community of builders. Devs, designers, artists, musicians, whatever - we're all nerds about something, and that something is usually skewed towards tech.
		</p>
		<p class="tagline">Think MMORPG vibes, but tech.</p>

		<div class="divider"></div>

		<h2>What are we like?</h2>
		<p>
			Everyone approaches their craft with love and a huge amount of effort. Guildies are from around the world, so expect a bunch of different cultures and personalities. The vibe is generally easygoing, littered with puns and terrible jokes.
		</p>
		<p class="reassurance">
			Atlantis is chaos only a portion of the time, we promise &lt;3
		</p>

		<a href="https://discord.com/invite/4gQAndh" target="_blank" rel="noopener noreferrer" class="discord-button">
			Join us on Discord
		</a>

		<div class="divider"></div>

		<h2>Some things we're doing right now</h2>
		<p>We're creating a collective mood board to define our design language direction... And brainstorm ideas for visualising Atlantis as an actual city.</p>
		
		<p>We're also starting a collaborative playlist to share favourite songs with each other. :D</p>
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

	@media (max-width: 768px) {
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
