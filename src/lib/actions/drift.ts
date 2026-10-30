import type { Action } from 'svelte/action';

/**
 * Makes an element lag a little behind the scroll, as if dragged through water, then ease back
 * into place with a slight overshoot once the page stops. Every element shares one scroll listener
 * and one animation loop, which only runs while something is still moving.
 *
 * The parameter scales how far it lags (default 1), so neighbouring items can drift a little
 * differently. Does nothing with reduced motion.
 */

// How far an element lags per pixel scrolled, the most it can lag (px), and the spring pulling it
// back: a little under critical damping, so it overshoots slightly before settling.
const DRAG = 0.12;
const MAX_OFFSET = 36;
const STIFFNESS = 60;
const DAMPING = 11;
const AT_REST = 0.05;

type Drifter = { node: HTMLElement; weight: number; offset: number; velocity: number };

const drifters = new Set<Drifter>();
let lastScrollY = 0;
let lastTime = 0;
let frame: number | null = null;

function onScroll(): void {
	const delta = window.scrollY - lastScrollY;
	lastScrollY = window.scrollY;
	// Scrolling down moves content up, so lagging behind means sitting a little lower.
	for (const drifter of drifters) {
		drifter.offset = Math.max(
			-MAX_OFFSET,
			Math.min(MAX_OFFSET, drifter.offset + delta * DRAG * drifter.weight)
		);
	}
	if (frame == null) {
		lastTime = performance.now();
		frame = requestAnimationFrame(step);
	}
}

function step(time: number): void {
	const dt = Math.min((time - lastTime) / 1000, 0.05);
	lastTime = time;
	let moving = false;

	for (const drifter of drifters) {
		drifter.velocity += (-STIFFNESS * drifter.offset - DAMPING * drifter.velocity) * dt;
		drifter.offset += drifter.velocity * dt;
		if (Math.abs(drifter.offset) < AT_REST && Math.abs(drifter.velocity) < AT_REST) {
			drifter.offset = 0;
			drifter.velocity = 0;
			drifter.node.style.transform = '';
		} else {
			drifter.node.style.transform = `translateY(${drifter.offset.toFixed(2)}px)`;
			moving = true;
		}
	}

	frame = moving ? requestAnimationFrame(step) : null;
}

export const drift: Action<HTMLElement, number | undefined> = (node, weight = 1) => {
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

	const drifter: Drifter = { node, weight, offset: 0, velocity: 0 };
	if (drifters.size === 0) {
		lastScrollY = window.scrollY;
		window.addEventListener('scroll', onScroll, { passive: true });
	}
	drifters.add(drifter);

	return {
		update(value) {
			drifter.weight = value ?? 1;
		},
		destroy() {
			drifters.delete(drifter);
			node.style.transform = '';
			if (drifters.size > 0) return;
			window.removeEventListener('scroll', onScroll);
			if (frame != null) cancelAnimationFrame(frame);
			frame = null;
		}
	};
};
