import * as THREE from 'three';
import { DEFAULT_THEME, getTheme } from '@ladyofcode/dice-themes';
import brownPhotostudioHdr from '@ladyofcode/dice-engine/environments/brown_photostudio.hdr?url';
import { createDie, disposeCache } from '@ladyofcode/dice-engine/engine/DiceFactory.js';
import { EnvironmentMap } from '@ladyofcode/dice-engine/engine/EnvironmentMap.js';
import { BloomPipeline } from '@ladyofcode/dice-engine/engine/effects/BloomPipeline.js';
import {
	DEFAULT_DIE_INDEX,
	DICE_TYPES,
	dieRowOffset,
	type DieSides,
	type DiceLayoutMode
} from './constants';
import { applyPreviewTheme } from './themeMaterials';

type PreviewDie = {
	mesh: THREE.Mesh;
	sides: DieSides;
};

export class DicePreviewScene {
	private readonly canvas: HTMLCanvasElement;
	private readonly scene = new THREE.Scene();
	private readonly diceGroup = new THREE.Group();
	private readonly camera: THREE.PerspectiveCamera;
	private readonly renderer: THREE.WebGLRenderer;
	private readonly bloom: BloomPipeline;
	private readonly environmentMap: EnvironmentMap;
	private readonly dice: PreviewDie[] = [];
	private readonly timer = new THREE.Timer();
	private animationFrameId: number | null = null;
	private destroyed = false;

	private layoutMode: DiceLayoutMode = 'desktop';
	private activeIndex = DEFAULT_DIE_INDEX;
	private themeKey = DEFAULT_THEME;
	private themeApplyGeneration = 0;
	private appliedDiceSet: string | null = null;
	private targetGroupX = 0;
	private currentGroupX = 0;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;

		this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
		this.camera.position.set(0, 1.2, 14);
		this.camera.lookAt(0, 0, 0);

		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: true
		});
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		this.environmentMap = new EnvironmentMap(this.renderer, { hdrUrl: brownPhotostudioHdr });
		this.environmentMap.init(this.scene);
		this.bloom = new BloomPipeline(this.renderer, this.scene, this.camera);
		this.timer.connect(document);

		this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

		const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.1);
		keyLight.position.set(4, 8, 6);
		this.scene.add(keyLight);

		const fillLight = new THREE.DirectionalLight(0xb8c8e8, 0.45);
		fillLight.position.set(-6, 2, 4);
		this.scene.add(fillLight);

		const rimLight = new THREE.DirectionalLight(0xffe8c8, 0.35);
		rimLight.position.set(0, -4, -8);
		this.scene.add(rimLight);

		DICE_TYPES.forEach((sides, index) => {
			const mesh = createDie(sides as DieSides);
			mesh.position.x = dieRowOffset(index);
			mesh.userData.spin = {
				x: 0.35 + index * 0.04,
				y: 0.55 + index * 0.03
			};
			this.dice.push({ mesh, sides: sides as DieSides });
			this.diceGroup.add(mesh);
		});

		this.scene.add(this.diceGroup);
		this.setTheme(DEFAULT_THEME);

		this.applyLayout();
		this.resize();
		this.start();
	}

	getTheme(): string {
		return this.themeKey;
	}

	setTheme(themeKey: string): void {
		if (this.destroyed) return;

		const theme = getTheme(themeKey);
		if (!theme) throw new Error(`Unknown theme: ${themeKey}`);

		const reloadDiceSet = this.appliedDiceSet !== theme.diceSet;
		const generation = ++this.themeApplyGeneration;

		void applyPreviewTheme(this.dice, themeKey, { reloadDiceSet })
			.then(() => {
				if (this.destroyed || generation !== this.themeApplyGeneration) return;
				this.bloom.applyFromTuning();
			})
			.catch((err: unknown) => {
				console.error('[DicePreviewScene] applyPreviewTheme failed', err);
			});

		this.appliedDiceSet = theme.diceSet;
		this.themeKey = themeKey;
	}

	setLayoutMode(mode: DiceLayoutMode): void {
		if (this.layoutMode === mode) return;
		this.layoutMode = mode;
		this.applyLayout();
	}

	setActiveIndex(index: number): void {
		const clamped = Math.max(0, Math.min(DICE_TYPES.length - 1, index));
		if (this.activeIndex === clamped) return;
		this.activeIndex = clamped;
		this.applyLayout();
	}

	getActiveIndex(): number {
		return this.activeIndex;
	}

	private applyLayout(): void {
		if (this.layoutMode === 'desktop') {
			this.targetGroupX = 0;
			this.diceGroup.scale.setScalar(1.2);
			this.camera.fov = 38;
			this.camera.position.z = 10.5;
		} else if (this.layoutMode === 'tablet') {
			this.targetGroupX = -dieRowOffset(this.activeIndex);
			this.diceGroup.scale.setScalar(1);
			this.camera.fov = 38;
			this.camera.position.z = 12;
		} else {
			this.targetGroupX = -dieRowOffset(this.activeIndex);
			this.diceGroup.scale.setScalar(1);
			this.camera.fov = 32;
			this.camera.position.z = 10.5;
		}

		this.camera.updateProjectionMatrix();
	}

	resize(): void {
		const width = this.canvas.clientWidth;
		const height = this.canvas.clientHeight;
		if (width <= 0 || height <= 0) return;

		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height, false);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.bloom.setSize(width, height);
	}

	private tick = (timestamp: number): void => {
		if (this.destroyed) return;

		this.timer.update(timestamp);
		const delta = this.timer.getDelta();

		this.currentGroupX = THREE.MathUtils.lerp(
			this.currentGroupX,
			this.targetGroupX,
			1 - Math.exp(-(this.layoutMode === 'desktop' ? 14 : 12) * delta)
		);
		this.diceGroup.position.x = this.currentGroupX;

		for (const { mesh: die } of this.dice) {
			const spin = die.userData.spin as { x: number; y: number };
			die.rotation.x += spin.x * delta;
			die.rotation.y += spin.y * delta;
		}

		this.bloom.render(delta);
		this.animationFrameId = requestAnimationFrame(this.tick);
	};

	start(): void {
		if (this.animationFrameId != null) return;
		this.animationFrameId = requestAnimationFrame(this.tick);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;

		if (this.animationFrameId != null) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}

		this.timer.disconnect();

		for (const { mesh: die } of this.dice) {
			if (Array.isArray(die.material)) {
				die.material.forEach((material: THREE.Material) => material.dispose());
			} else {
				die.material.dispose();
			}
		}

		disposeCache();
		this.bloom.dispose();
		this.scene.clear();
		this.scene.environment = null;
		this.environmentMap.dispose();
		this.renderer.dispose();
	}
}
