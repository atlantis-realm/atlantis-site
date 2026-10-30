import type { Component } from 'svelte';

export type BlogPost = {
	slug: string;
	title: string;
	author: string;
	date: string;
	excerpt: string;
	image?: string;
};

type PostModule = { default: Component; metadata: Omit<BlogPost, 'slug'> };

// Each post is a markdown file in ./blog; its frontmatter is the metadata and its filename the slug.
const modules = import.meta.glob<PostModule>('./blog/*.md', { eager: true });

const slugOf = (path: string) => path.slice(path.lastIndexOf('/') + 1, -'.md'.length);

export const blogPosts: BlogPost[] = Object.entries(modules)
	.map(([path, mod]) => ({ ...mod.metadata, slug: slugOf(path) }))
	.sort((a, b) => b.date.localeCompare(a.date));

export function getPost(slug: string): { post: BlogPost; content: Component } | undefined {
	const mod = modules[`./blog/${slug}.md`];
	return mod && { post: { ...mod.metadata, slug }, content: mod.default };
}
