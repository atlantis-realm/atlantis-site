<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Not found' : 'Error'} · Atlantis</title>
</svelte:head>

<OceanPage title={page.status === 404 ? 'Lost at sea' : 'Something went wrong'}>
	<section class="card">
		<p>
			{#if page.status === 404}
				This page doesn't exist. Maybe it sank?
			{:else}
				{page.error?.message ?? 'An unexpected error occurred.'}
			{/if}
		</p>
		<p><a href="/">Back to home</a></p>
	</section>
</OceanPage>
