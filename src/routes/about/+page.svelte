<script lang="ts">
	import Barcode from '#lib/components/Barcode.svelte';
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
</script>

<svelte:head>
	<title>About · Atlantis</title>
</svelte:head>

<OceanPage title="About">
	<!-- Separate topics rather than a sequence, so the cards alternate sides down the page. -->
	<div class="alternating">
		<section class="card hud">
			<p>
				Atlantis is a community of builders. Devs, designers, artists, musicians — we're all nerds
				about something, usually skewed towards tech.
			</p>
			<p><em>Think MMORPG vibes, but tech.</em></p>
		</section>

		<section class="card hud">
			<h2>What are we like?</h2>
			<p>
				Everyone approaches their craft with love and a huge amount of effort. Guildies are from
				around the world, so expect a bunch of different cultures and personalities. The vibe is
				generally easygoing, littered with puns and terrible jokes.
			</p>
			<p><em>Atlantis is chaos only a portion of the time, we promise &lt;3</em></p>
		</section>

		<section class="card hud">
			<h2 class="added">Values</h2>
			<p class="added">Our values go here.</p>
		</section>

		<section class="card hud">
			<h2 class="added">Team</h2>
			<a href="/about/team" class="hud-button hud-button--outline">Meet the team</a>
		</section>

		<section class="card hud">
			<h2>Join us</h2>
			<a
				href="https://discord.com/invite/4gQAndh"
				target="_blank"
				rel="noopener noreferrer"
				class="hud-button"
			>
				Join us on Discord
			</a>
		</section>
	</div>

	<!-- Alom's barcode creature: hover it and it hops and waves. -->
	<div class="barcode-creature">
		<Barcode />
	</div>
</OceanPage>

<style>
	.alternating {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.alternating > * {
		width: min(100%, 40rem);
	}

	.alternating > :nth-child(even) {
		margin-left: auto;
	}

	.alternating .hud-button {
		margin: 0.5rem 0;
	}

	.barcode-creature {
		width: min(100%, 14rem);
		margin: 3rem auto 0;
	}
</style>
