import { error } from '@sveltejs/kit';
import { blogPosts, getPost } from '#lib/content/blogPosts.js';
import type { PageLoad } from './$types';

export const prerender = true;

export function entries() {
	return blogPosts.map((post) => ({ slug: post.slug }));
}

export const load: PageLoad = ({ params }) => {
	const found = getPost(params.slug);

	if (!found) {
		error(404, 'Post not found');
	}

	return found;
};
