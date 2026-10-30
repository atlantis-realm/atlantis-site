import { getContext, setContext } from 'svelte';

// Counts the work a page's scenes do before they're ready to show (loading their code, compiling
// their shaders), so the page can hold a loading screen over them until it's all done. Like
// three's LoadingManager, but for any promise rather than only files.
export class LoadingTracker {
	total = $state(0);
	loaded = $state(0);

	/** 0..1, how much of the tracked work has finished. */
	get progress(): number {
		return this.total === 0 ? 0 : this.loaded / this.total;
	}

	/** Only once something has been tracked, so a page isn't ready before its scenes have started. */
	get done(): boolean {
		return this.total > 0 && this.loaded === this.total;
	}

	/** Failed work counts as finished too, so one broken scene doesn't hold the screen forever. */
	track(task: Promise<unknown>): void {
		this.total++;
		void task.finally(() => this.loaded++);
	}
}

const KEY = Symbol('loading');

export function setLoadingTracker(tracker: LoadingTracker): void {
	setContext(KEY, tracker);
}

/** The tracker for the page this component is on, if it has one. Call during component init. */
export function getLoadingTracker(): LoadingTracker | undefined {
	return getContext<LoadingTracker | undefined>(KEY);
}
