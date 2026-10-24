export type AtlantisEvent = {
	name: string;
	description: string;
};

export const upcomingEvents: AtlantisEvent[] = [
	{
		name: 'Atlantis Forum',
		description: 'Weekly discussion around events and admin, then general chatter.'
	},
	{
		name: 'Project Check-ins',
		description:
			'Weekly accountability on projects and careers — minimal venting, help removing blockers.'
	}
];

export const ongoingEvents: AtlantisEvent[] = [
	{
		name: 'Design jam',
		description:
			'Co-creating shared design language and visual identity for Atlantis as a city.'
	},
	{
		name: 'Music Practice',
		description:
			'Voice call, muted practice, mic on for chat, help, and demos. Any instrument or music-related activity.'
	},
	{
		name: 'Syrenware',
		description: 'Community playlist of guildie favourites old and new.'
	}
];
