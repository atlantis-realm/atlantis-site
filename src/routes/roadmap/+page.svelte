<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';

	const ongoing = [
		{
			name: 'Design jam',
			description:
				"We're co-creating shared design language and visual identity components to use across our brand and general aesthetics for representing Atlantis as a city."
		},
		{
			name: 'Music Practice',
			description:
				'We sit in a voice call and mute ourselves while we practice, turning on the mic for chit chat, help, and demos. Bring any instrument or music-related activity!'
		},
		{
			name: 'Project Check-ins',
			description:
				'Weekly accountability updates on our projects/careers, including minimal venting, and asking for help to remove blockers'
		},
		{
			name: 'Atlantis Forum',
			description:
				'Weekly discussion around events and admin followed by general chatter. All are welcome to join!'
		},
		{
			name: 'Syrenware',
			description: 'A community playlist that represents favourites old and new among guildies.'
		}
	];

	const upcoming = [
		{
			title: 'Community Platform Launch',
			date: 'January 2025',
			description:
				'Launch our new community platform with enhanced features for builders and creators to connect and collaborate together seamlessly.'
		},
		{
			title: 'Design System Release',
			date: 'March 2025',
			description:
				'Release our comprehensive design system with components, guidelines, and tools for consistent visual language across all projects.'
		},
		{
			title: 'Developer Tools Suite',
			date: 'May 2025',
			description:
				'Introduce a suite of developer tools and APIs to help builders create amazing projects faster and more efficiently.'
		},
		{
			title: 'Collaboration Features',
			date: 'July 2025',
			description:
				'Add advanced collaboration features including real-time editing, project sharing, team workspaces, and seamless communication tools.'
		},
		{
			title: 'Mobile App Beta',
			date: 'September 2025',
			description:
				'Launch beta version of our mobile app for iOS and Android with core community features and essential tools.'
		},
		{
			title: 'Global Event Series',
			date: 'November 2025',
			description:
				'Kick off our global event series with virtual and in-person meetups for community members worldwide to connect.'
		}
	];
</script>

<svelte:head>
	<title>Roadmap · Atlantis</title>
</svelte:head>

<OceanPage title="Roadmap">
	<section>
		<h2 class="file-label">&lt;&lt; ongoing_even.ts</h2>
		<!-- A list of what's running now, banded down the page. -->
		<ul class="hud-band hud-band--column">
			{#each ongoing as item (item.name)}
				<li>
					<h3>{item.name}</h3>
					<p>{item.description}</p>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2 class="file-label">&lt;&lt; checkpoin.ts</h2>
		<!-- Milestones in order, banded down the page like a timeline: date, then what lands. -->
		<ol class="hud-band hud-band--column milestones">
			{#each upcoming as milestone (milestone.title)}
				<li>
					<p class="date">{milestone.date}</p>
					<div>
						<h3>{milestone.title}</h3>
						<p>{milestone.description}</p>
					</div>
				</li>
			{/each}
		</ol>
	</section>
</OceanPage>

<style>
	section + section {
		margin-top: 2rem;
	}

	.milestones li {
		display: grid;
		grid-template-columns: 11rem 1fr;
		gap: 1.5rem;
	}

	.milestones p {
		margin: 0;
	}

	.date {
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		color: var(--hud-accent);
	}

	@media (max-width: 640px) {
		.milestones li {
			grid-template-columns: 1fr;
			gap: 0.5rem;
		}
	}
</style>
