<section class="roadmap-section">
	<div class="content-wrapper">
		<h1>Roadmap</h1>

		<section class="ongoing-events">
			<h2>Ongoing</h2>
			<ul class="events-list">
				<li>
					<strong>Design jam:</strong> We're co-creating shared design language and visual identity components
					to use across our brand and general aesthetics for representing Atlantis as a city.
				</li>
				<li>
					<strong>Music Practice:</strong> We sit in a voice call and mute ourselves while we practice,
					turning on the mic for chit chat, help, and demos. Bring any instrument or music-related activity!
				</li>
				<li>
					<strong>Project Check-ins:</strong> Weekly accountability updates on our projects/careers,
					including minimal venting, and asking for help to remove blockers
				</li>
				<li>
					<strong>Atlantis Forum:</strong> Weekly discussion around events and admin followed by general
					chatter. All are welcome to join!
				</li>
				<li>
					<strong>Syrenware:</strong> A community playlist that represents favourites old and new among
					guildies.
				</li>
			</ul>
		</section>

		<section>
			<h2>Upcoming</h2>

			<div class="roadmap-container">
				<div class="roadmap-item">
					<div class="roadmap-content">
						<div class="roadmap-header">
							<h2>Community Platform Launch</h2>
							<span class="roadmap-date">January 2025</span>
						</div>
						<p class="roadmap-description">
							Launch our new community platform with enhanced features for builders and creators to
							connect and collaborate together seamlessly.
						</p>
					</div>
				</div>

				<div class="roadmap-item">
					<div class="roadmap-content">
						<div class="roadmap-header">
							<h2>Design System Release</h2>
							<span class="roadmap-date">March 2025</span>
						</div>
						<p class="roadmap-description">
							Release our comprehensive design system with components, guidelines, and tools for
							consistent visual language across all projects.
						</p>
					</div>
				</div>

				<div class="roadmap-item">
					<div class="roadmap-content">
						<div class="roadmap-header">
							<h2>Developer Tools Suite</h2>
							<span class="roadmap-date">May 2025</span>
						</div>
						<p class="roadmap-description">
							Introduce a suite of developer tools and APIs to help builders create amazing projects
							faster and more efficiently.
						</p>
					</div>
				</div>

				<div class="roadmap-item">
					<div class="roadmap-content">
						<div class="roadmap-header">
							<h2>Collaboration Features</h2>
							<span class="roadmap-date">July 2025</span>
						</div>
						<p class="roadmap-description">
							Add advanced collaboration features including real-time editing, project sharing, team
							workspaces, and seamless communication tools.
						</p>
					</div>
				</div>

				<div class="roadmap-item">
					<div class="roadmap-content">
						<div class="roadmap-header">
							<h2>Mobile App Beta</h2>
							<span class="roadmap-date">September 2025</span>
						</div>
						<p class="roadmap-description">
							Launch beta version of our mobile app for iOS and Android with core community features
							and essential tools.
						</p>
					</div>
				</div>

				<div class="roadmap-item">
					<div class="roadmap-content">
						<div class="roadmap-header">
							<h2>Global Event Series</h2>
							<span class="roadmap-date">November 2025</span>
						</div>
						<p class="roadmap-description">
							Kick off our global event series with virtual and in-person meetups for community
							members worldwide to connect.
						</p>
					</div>
				</div>
			</div>
		</section>
	</div>
</section>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&display=swap');
	@import url('https://fonts.googleapis.com/css2?family=Ubuntu+Sans+Mono:wght@400;500;600;700&display=swap');

	.roadmap-section {
		position: relative;
		min-height: 100vh;
		background: linear-gradient(to bottom, #2e4057 0%, #1a2838 100%);
		padding: 80px 20px;
		color: #eeefb7;
		font-family: 'Ubuntu Sans Mono', monospace;
	}

	.content-wrapper {
		max-width: 900px;
		width: 100%;
		margin: 0 auto;
	}

	h1 {
		font-family: 'Cinzel Decorative', cursive;
		font-size: 3rem;
		margin-bottom: 4rem;
		color: hsl(45, 67%, 74%);
		letter-spacing: 2px;
		text-align: center;
	}

	.ongoing-events {
		margin-bottom: 5rem;
	}

	h2 {
		font-family: 'Cinzel Decorative', cursive;
		font-size: 2rem;
		margin-bottom: 2rem;
		color: hsl(45, 67%, 74%);
		letter-spacing: 1px;
		text-align: center;
	}

	.events-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.events-list li {
		font-size: 1.1rem;
		line-height: 1.8;
		color: rgba(238, 239, 183, 0.9);
		margin-bottom: 1rem;
		padding-left: 1.5rem;
		position: relative;
	}

	.events-list li:last-child {
		margin-bottom: 0;
	}

	.events-list li::before {
		content: '•';
		position: absolute;
		left: 0;
		color: hsl(45, 67%, 74%);
		font-size: 1.5rem;
		line-height: 1.8;
	}

	.events-list li strong {
		color: hsl(45, 67%, 74%);
		font-weight: 600;
	}

	.roadmap-container {
		position: relative;
	}

	.roadmap-item {
		position: relative;
		margin-bottom: 4rem;
	}

	.roadmap-item:last-child {
		margin-bottom: 0;
	}

	.roadmap-content {
		background: rgba(30, 40, 57, 0.5);
		padding: 2rem;
		border-radius: 8px;
		border-left: 3px solid hsl(45, 67%, 74%);
		backdrop-filter: blur(5px);
	}

	.roadmap-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
		gap: 2rem;
	}

	.roadmap-header h2 {
		font-family: 'Cinzel Decorative', cursive;
		font-size: 1.8rem;
		margin: 0;
		color: hsl(45, 67%, 74%);
		letter-spacing: 1px;
		flex: 1;
	}

	.roadmap-date {
		font-size: 1.1rem;
		color: rgba(238, 239, 183, 0.8);
		font-weight: 600;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.roadmap-description {
		font-size: 1.1rem;
		line-height: 1.8;
		color: rgba(238, 239, 183, 0.9);
		margin: 0;
	}

	@media (max-width: 768px) {
		h1 {
			font-size: 2rem;
			margin-bottom: 3rem;
		}

		.ongoing-events {
			margin-bottom: 4rem;
		}

		.ongoing-events h2 {
			font-size: 1.5rem;
			margin-bottom: 1.5rem;
		}

		.events-list li {
			font-size: 1rem;
		}

		.roadmap-content {
			padding: 1.5rem;
		}

		.roadmap-header {
			flex-direction: column;
			gap: 0.5rem;
		}

		.roadmap-header h2 {
			font-size: 1.5rem;
		}

		.roadmap-date {
			font-size: 1rem;
			order: -1;
		}

		.roadmap-description {
			font-size: 1rem;
		}
	}
</style>
