import * as THREE from 'three';
import { EARTH_POINTS, LAND_MASK } from './earthLand.js';

// A small cyan hologram of the Earth: land as glowing dots, a faint lat/long grid, a rim glow and
// an orbiting moon. Everything is additive and ignores depth, so the far side shows through
// faintly, like a projection rather than a solid ball.
//
// The moon drifts towards the cursor when it's near. A few places are marked with glowing dots;
// hovering one stops the spin, brings the moon round to it and zaps the dot from there.

const CYAN = new THREE.Color('hsl(185, 90%, 60%)');
const HOT = new THREE.Color('hsl(320, 100%, 65%)');
const WHITE = new THREE.Color(0xffffff);
const SPIN_SPEED = 0.12; // radians per second
const ORBIT_RADIUS = 1.35;
const ORBIT_SPEED = 0.4;
// Nearly edge-on: tipped towards the viewer just enough to open into a thin ellipse, then leaned
// in the screen plane ('ZYX' applies the tip first, then the lean).
const ORBIT_TILT = new THREE.Euler(0.3, 0, 0.4, 'ZYX');
const GRID_STEP = 30; // degrees between grid lines
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const FOV = 35;
// Framed tightly: the globe (plus its bob) fills the height, and the flat orbit, which is much
// wider than it is tall, fits across the width.
const VIEW_HALF_HEIGHT = 1.1;
const VIEW_HALF_WIDTH = ORBIT_RADIUS + 0.05;
const CAMERA_DISTANCE = VIEW_HALF_HEIGHT / Math.tan(THREE.MathUtils.degToRad(FOV / 2));

// A slow float: up and down over about seven seconds, with a slight sway. The orbit trails the
// globe by up to ORBIT_LAG (radians of the bob, ~0.4s) mid-stroke, easing to no lag at the top and
// bottom, so it has caught up by the time the globe turns back the other way.
const BOB_SPEED = 0.9; // radians per second
const BOB_HEIGHT = 0.04;
const BOB_ROLL = 0.015; // radians
const ORBIT_LAG = 0.35;

// The moon never leaves its ring; it slides round towards the cursor. How far from the ring (as
// drawn on screen) the cursor still pulls it (px), how fast it catches up, and how finely the ring
// is searched for the point nearest the cursor.
const FOLLOW_REACH = 90;
const FOLLOW_RATE = 5;
const RING_SAMPLES = 128;

// Marked places (latitude, longitude in degrees), and how near the cursor has to be to a dot (px)
// to count as hovering it. Cambridge and London, and Canberra and Sydney, are close enough to
// share a dot at this size; the hover picks whichever is nearer the cursor.
const PLACES = [
	{ name: 'Canberra', lat: -35.28, lon: 149.13 },
	{ name: 'Sydney', lat: -33.869, lon: 151.209 },
	{ name: 'Cambridge', lat: 52.205, lon: 0.119 },
	{ name: 'London', lat: 51.507, lon: -0.128 },
	{ name: 'Zurich', lat: 47.377, lon: 8.541 },
	{ name: 'Zagreb', lat: 45.815, lon: 15.982 },
	{ name: 'Bangalore', lat: 12.972, lon: 77.594 },
	{ name: 'Montreal', lat: 45.502, lon: -73.567 },
	{ name: 'Lancaster, PA', lat: 40.038, lon: -76.306 }
];
const HOVER_RADIUS = 22;

// The zap is a jagged line redrawn a few times a second, thickest in the middle.
const ZAP_POINTS = 14;
const ZAP_JITTER = 0.08; // as a fraction of its length
const ZAP_REFRESH = 0.05; // seconds

// Longitude 0 faces the camera (+z) and east is to the right (+x).
function toVector(lat: number, lon: number, radius = 1): THREE.Vector3 {
	return new THREE.Vector3(
		radius * Math.cos(lat) * Math.sin(lon),
		radius * Math.sin(lat),
		radius * Math.cos(lat) * Math.cos(lon)
	);
}

function landPositions(): Float32Array {
	const mask = Uint8Array.from(atob(LAND_MASK), (c) => c.charCodeAt(0));
	const positions: number[] = [];
	for (let i = 0; i < EARTH_POINTS; i++) {
		if (!((mask[i >> 3] >> (i & 7)) & 1)) continue;
		const lat = Math.asin(1 - (2 * (i + 0.5)) / EARTH_POINTS);
		const lon = i * GOLDEN_ANGLE;
		positions.push(...toVector(lat, lon).toArray());
	}
	return new Float32Array(positions);
}

function gridPositions(): Float32Array {
	const positions: number[] = [];
	const segments = 64;
	const line = (point: (t: number) => THREE.Vector3) => {
		for (let s = 0; s < segments; s++) {
			positions.push(...point(s / segments).toArray(), ...point((s + 1) / segments).toArray());
		}
	};
	for (let lat = -90 + GRID_STEP; lat < 90; lat += GRID_STEP) {
		const phi = THREE.MathUtils.degToRad(lat);
		line((t) => toVector(phi, t * Math.PI * 2, 1.002));
	}
	for (let lon = 0; lon < 360; lon += GRID_STEP) {
		const lambda = THREE.MathUtils.degToRad(lon);
		line((t) => toVector((t - 0.5) * Math.PI, lambda, 1.002));
	}
	return new Float32Array(positions);
}

// Dots fade on the far side, so the near hemisphere reads clearly.
const dotMaterial = () =>
	new THREE.ShaderMaterial({
		uniforms: { uColor: { value: CYAN }, uSize: { value: 0.035 }, uScale: { value: 1 } },
		vertexShader: /* glsl */ `
			uniform float uSize;
			uniform float uScale;
			varying float vFacing;
			void main() {
				vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
				vFacing = normalize(normalMatrix * position).z;
				gl_PointSize = uSize * uScale / -viewPosition.z;
				gl_Position = projectionMatrix * viewPosition;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			varying float vFacing;
			void main() {
				float d = length(gl_PointCoord - 0.5);
				float disc = smoothstep(0.5, 0.2, d);
				float side = mix(0.12, 1.0, smoothstep(-0.2, 0.35, vFacing));
				gl_FragColor = vec4(uColor * disc * side, 1.0);
			}
		`,
		blending: THREE.AdditiveBlending,
		depthTest: false,
		depthWrite: false,
		transparent: true
	});

// Rim glow plus faint scanlines drifting down the sphere.
const shellMaterial = () =>
	new THREE.ShaderMaterial({
		uniforms: { uColor: { value: CYAN }, uTime: { value: 0 } },
		vertexShader: /* glsl */ `
			varying vec3 vNormal;
			varying vec3 vView;
			void main() {
				vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
				vNormal = normalize(normalMatrix * normal);
				vView = normalize(-viewPosition.xyz);
				gl_Position = projectionMatrix * viewPosition;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			uniform float uTime;
			varying vec3 vNormal;
			varying vec3 vView;
			void main() {
				float rim = pow(1.0 - abs(dot(vNormal, vView)), 2.5);
				float scan = 0.75 + 0.25 * sin(gl_FragCoord.y * 0.9 - uTime * 4.0);
				gl_FragColor = vec4(uColor * (0.05 + rim * 0.9) * scan, 1.0);
			}
		`,
		blending: THREE.AdditiveBlending,
		depthTest: false,
		depthWrite: false,
		transparent: true
	});

// Soft round glow for the place dots: white-hot core fading out.
function glowTexture(): THREE.CanvasTexture {
	const size = 64;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const context = canvas.getContext('2d')!;
	const gradient = context.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2
	);
	gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
	gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
	gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
	gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
	context.fillStyle = gradient;
	context.fillRect(0, 0, size, size);
	return new THREE.CanvasTexture(canvas);
}

const additiveLine = (color: THREE.Color, opacity: number) =>
	new THREE.LineBasicMaterial({
		color,
		transparent: true,
		opacity,
		blending: THREE.AdditiveBlending,
		depthTest: false,
		depthWrite: false
	});

type Bolt = { line: THREE.Line; offsets: Float32Array; jitter: number };
type Place = { position: THREE.Vector3; glow: THREE.Sprite };

export class HoloEarth {
	private readonly canvas: HTMLCanvasElement;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
	private readonly renderer: THREE.WebGLRenderer;
	// The planet (globe and its glow shell) and the orbit (ring and moon) bob separately.
	private readonly planet = new THREE.Group();
	private readonly orbit = new THREE.Group();
	private readonly globe = new THREE.Group();
	private readonly moon: THREE.Mesh;
	private readonly dots: THREE.ShaderMaterial;
	private readonly shell: THREE.ShaderMaterial;
	private readonly places: Place[];
	private readonly glowMap = glowTexture();
	// A bright core and a wider, wilder outer bolt.
	private readonly bolts: Bolt[];
	private readonly timer = new THREE.Timer();
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	private pointer: { x: number; y: number } | null = null;
	private spin = 0;
	private orbitAngle = 0;
	private elapsed = 0;
	private sinceZapRefresh = Infinity;
	private zapping = false;
	private animationFrameId: number | null = null;
	private destroyed = false;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.camera.position.z = CAMERA_DISTANCE;

		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		this.renderer.setClearColor(0x000000, 0);
		this.planet.add(this.globe);
		this.scene.add(this.planet, this.orbit);

		this.dots = dotMaterial();
		const land = new THREE.BufferGeometry();
		land.setAttribute('position', new THREE.BufferAttribute(landPositions(), 3));
		this.globe.add(new THREE.Points(land, this.dots));

		const grid = new THREE.BufferGeometry();
		grid.setAttribute('position', new THREE.BufferAttribute(gridPositions(), 3));
		this.globe.add(new THREE.LineSegments(grid, additiveLine(CYAN, 0.15)));

		this.shell = shellMaterial();
		this.planet.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.shell));

		this.places = PLACES.map(({ lat, lon }) => {
			const position = toVector(THREE.MathUtils.degToRad(lat), THREE.MathUtils.degToRad(lon));
			const glow = new THREE.Sprite(
				new THREE.SpriteMaterial({
					map: this.glowMap,
					color: HOT,
					blending: THREE.AdditiveBlending,
					depthTest: false,
					depthWrite: false
				})
			);
			glow.position.copy(position);
			this.globe.add(glow);
			return { position, glow };
		});

		// The orbit sits at its own angle, so the ring reads as separate from the globe.
		const ringPoints = Array.from({ length: 129 }, (_, i) =>
			this.orbitPosition((i / 128) * Math.PI * 2)
		);
		this.orbit.add(
			new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints), additiveLine(CYAN, 0.75))
		);
		this.moon = new THREE.Mesh(
			new THREE.SphereGeometry(0.045, 12, 8),
			new THREE.MeshBasicMaterial({ color: CYAN, depthTest: false, transparent: true })
		);
		this.moon.position.copy(this.orbitPosition(0));
		this.orbit.add(this.moon);

		this.bolts = [
			{ color: WHITE, opacity: 0.95, jitter: ZAP_JITTER * 0.5 },
			{ color: HOT, opacity: 0.8, jitter: ZAP_JITTER }
		].map(({ color, opacity, jitter }) => {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute(
				'position',
				new THREE.BufferAttribute(new Float32Array(ZAP_POINTS * 3), 3)
			);
			const line = new THREE.Line(geometry, additiveLine(color, opacity));
			line.frustumCulled = false;
			line.visible = false;
			this.scene.add(line);
			return { line, offsets: new Float32Array(ZAP_POINTS * 2), jitter };
		});

		window.addEventListener('pointermove', this.onPointerMove, { passive: true });
		document.documentElement.addEventListener('pointerleave', this.onPointerLeave);

		this.resize();
		this.render(0);
	}

	private onPointerMove = (event: PointerEvent): void => {
		this.pointer = { x: event.clientX, y: event.clientY };
	};

	private onPointerLeave = (): void => {
		this.pointer = null;
	};

	private orbitPosition(angle: number): THREE.Vector3 {
		return new THREE.Vector3(
			Math.cos(angle) * ORBIT_RADIUS,
			0,
			Math.sin(angle) * ORBIT_RADIUS
		).applyEuler(ORBIT_TILT);
	}

	// The orbit angle whose point is closest to `point`: its direction projected into the orbit's plane.
	private orbitAngleNearest(point: THREE.Vector3): number {
		const u = new THREE.Vector3(1, 0, 0).applyEuler(ORBIT_TILT);
		const v = new THREE.Vector3(0, 0, 1).applyEuler(ORBIT_TILT);
		return Math.atan2(point.dot(v), point.dot(u));
	}

	resize(): void {
		const width = this.canvas.clientWidth;
		const height = this.canvas.clientHeight;
		if (width <= 0 || height <= 0) return;

		const pixelRatio = Math.min(window.devicePixelRatio, 2);
		this.camera.aspect = width / height;
		// Pull back when the box is too narrow for the orbit to fit across it.
		this.camera.zoom = Math.min(1, (this.camera.aspect * VIEW_HALF_HEIGHT) / VIEW_HALF_WIDTH);
		this.camera.updateProjectionMatrix();
		this.renderer.setPixelRatio(pixelRatio);
		this.renderer.setSize(width, height, false);
		// Point size is in pixels, so scale it with the drawing height.
		this.dots.uniforms.uScale.value = height * pixelRatio * this.camera.zoom;
		if (this.animationFrameId == null) this.render(0);
	}

	// The orbit angle whose point on screen is nearest the cursor, or null when the cursor is more
	// than FOLLOW_REACH from the ring. Judged on screen rather than in 3D, so it matches where the
	// ring is drawn.
	private cursorAngle(rect: DOMRect): number | null {
		if (!this.pointer) return null;
		const { x, y } = this.pointer;
		let nearest = 0;
		let nearestDistance = Infinity;
		for (let i = 0; i < RING_SAMPLES; i++) {
			const angle = (i / RING_SAMPLES) * Math.PI * 2;
			const screen = this.orbitPosition(angle).add(this.orbit.position).project(this.camera);
			const distance = Math.hypot(
				rect.left + ((screen.x + 1) / 2) * rect.width - x,
				rect.top + ((1 - screen.y) / 2) * rect.height - y
			);
			if (distance < nearestDistance) {
				nearest = angle;
				nearestDistance = distance;
			}
		}
		return nearestDistance <= FOLLOW_REACH ? nearest : null;
	}

	// The index of the place under the cursor, or -1. Only places on the near side count.
	private hoveredPlace(positions: THREE.Vector3[], rect: DOMRect): number {
		if (!this.pointer) return -1;
		let hovered = -1;
		let nearestDistance = HOVER_RADIUS;
		positions.forEach((position, i) => {
			if (position.z < 0.2) return;
			const screen = position.clone().project(this.camera);
			const distance = Math.hypot(
				rect.left + ((screen.x + 1) / 2) * rect.width - this.pointer!.x,
				rect.top + ((1 - screen.y) / 2) * rect.height - this.pointer!.y
			);
			if (distance < nearestDistance) {
				hovered = i;
				nearestDistance = distance;
			}
		});
		return hovered;
	}

	private updateZap(from: THREE.Vector3, to: THREE.Vector3, delta: number): void {
		for (const bolt of this.bolts) bolt.line.visible = this.zapping;
		if (!this.zapping) {
			this.sinceZapRefresh = Infinity;
			return;
		}

		// New jags a few times a second; with reduced motion, one shape per zap.
		this.sinceZapRefresh += delta;
		if (
			this.sinceZapRefresh >= ZAP_REFRESH &&
			(!this.reducedMotion || this.sinceZapRefresh === Infinity)
		) {
			this.sinceZapRefresh = 0;
			for (const bolt of this.bolts) {
				for (let i = 0; i < bolt.offsets.length; i++) bolt.offsets[i] = Math.random() * 2 - 1;
				(bolt.line.material as THREE.LineBasicMaterial).opacity = 0.6 + Math.random() * 0.4;
			}
		}

		// Offsets run across the bolt, both sideways on screen and towards the viewer.
		const along = to.clone().sub(from);
		const length = along.length();
		const side = along
			.clone()
			.cross(new THREE.Vector3(0, 0, 1))
			.normalize();
		if (side.lengthSq() === 0) side.set(1, 0, 0);
		const up = along.clone().cross(side).normalize();
		const point = new THREE.Vector3();

		for (const { line, offsets, jitter } of this.bolts) {
			const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
			for (let i = 0; i < ZAP_POINTS; i++) {
				const t = i / (ZAP_POINTS - 1);
				const spread = Math.sin(Math.PI * t) * jitter * length;
				point
					.lerpVectors(from, to, t)
					.addScaledVector(side, offsets[i * 2] * spread)
					.addScaledVector(up, offsets[i * 2 + 1] * spread);
				positions.setXYZ(i, point.x, point.y, point.z);
			}
			positions.needsUpdate = true;
		}
	}

	private render(delta: number): void {
		const motion = this.reducedMotion ? 0 : delta;
		this.elapsed += motion;

		// The hologram bobs very slowly, as if floating, with the orbit easing along a moment behind
		// the globe. The sway rolls the camera, so it moves both together. All updated before the
		// hover checks below, which work in world space and project through the camera.
		const bob = this.elapsed * BOB_SPEED;
		this.planet.position.y = Math.sin(bob) * BOB_HEIGHT;
		this.orbit.position.y = Math.sin(bob - ORBIT_LAG * Math.cos(bob) ** 2) * BOB_HEIGHT;
		this.camera.rotation.z = Math.sin(this.elapsed * BOB_SPEED * 0.7) * BOB_ROLL;
		this.camera.updateMatrixWorld();

		// The spin holds still while the zap is on.
		if (!this.zapping) this.spin += motion * SPIN_SPEED;
		this.globe.rotation.y = this.spin;

		const rect = this.canvas.getBoundingClientRect();
		// Places in world space: spun with the globe, lifted with the planet.
		const positions = this.places.map(({ position }) =>
			position
				.clone()
				.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.spin)
				.add(this.planet.position)
		);
		const hovered = this.hoveredPlace(positions, rect);
		const zapped = positions[hovered];
		this.zapping = zapped != null;

		// The moon only ever moves along its ring. Hovering a place sends it round to the point
		// nearest that place; otherwise it heads for the point nearest the cursor when that's close,
		// and orbits on its own when it isn't. It goes the short way round.
		const target = zapped
			? this.orbitAngleNearest(zapped.clone().sub(this.orbit.position))
			: this.cursorAngle(rect);
		if (target == null) {
			this.orbitAngle += motion * ORBIT_SPEED;
		} else {
			const gap = Math.atan2(
				Math.sin(target - this.orbitAngle),
				Math.cos(target - this.orbitAngle)
			);
			this.orbitAngle += this.reducedMotion ? gap : gap * (1 - Math.exp(-FOLLOW_RATE * delta));
		}
		this.moon.position.copy(this.orbitPosition(this.orbitAngle));
		const moon = this.moon.position.clone().add(this.orbit.position);
		// Dim the moon while it's behind the globe, since nothing hides it there.
		const { x, y, z } = moon.clone().sub(this.planet.position);
		(this.moon.material as THREE.MeshBasicMaterial).opacity =
			z < 0 && Math.hypot(x, y) < 1 ? 0.3 : 1;

		// Dots dim on the far side, pulse gently (out of step) to invite a hover, and flare when zapped.
		this.places.forEach(({ glow }, i) => {
			const lit = i === hovered;
			const facing = THREE.MathUtils.smoothstep(positions[i].z, -0.2, 0.3);
			glow.material.opacity = THREE.MathUtils.lerp(0.15, 1, facing);
			glow.material.color.copy(HOT).lerp(WHITE, lit ? 0.45 : 0);
			glow.scale.setScalar(lit ? 0.22 : 0.1 + 0.015 * Math.sin(this.elapsed * 3 + i * 1.3));
		});
		this.canvas.style.cursor = this.zapping ? 'crosshair' : '';

		// The bolt lands just above the surface, out along the place's direction from the centre.
		const landing = zapped
			?.clone()
			.sub(this.planet.position)
			.multiplyScalar(1.01)
			.add(this.planet.position);
		this.updateZap(moon, landing ?? moon, delta);

		this.shell.uniforms.uTime.value = this.elapsed;
		this.renderer.render(this.scene, this.camera);
	}

	private tick = (timestamp: number): void => {
		if (this.destroyed) return;
		this.timer.update(timestamp);
		// Capped so a dropped frame doesn't jolt the spin.
		this.render(Math.min(this.timer.getDelta(), 0.1));
		this.animationFrameId = requestAnimationFrame(this.tick);
	};

	// Runs while on screen. With reduced motion nothing spins or orbits, but the moon still answers
	// the cursor and the zap still fires.
	start(): void {
		if (this.destroyed || this.animationFrameId != null) return;
		// Pick up where it stopped rather than jumping ahead by the time spent off screen.
		this.timer.reset();
		this.animationFrameId = requestAnimationFrame(this.tick);
	}

	stop(): void {
		if (this.animationFrameId == null) return;
		cancelAnimationFrame(this.animationFrameId);
		this.animationFrameId = null;
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.stop();
		this.timer.disconnect();
		window.removeEventListener('pointermove', this.onPointerMove);
		document.documentElement.removeEventListener('pointerleave', this.onPointerLeave);
		this.scene.traverse((object) => {
			if (
				object instanceof THREE.Mesh ||
				object instanceof THREE.Line ||
				object instanceof THREE.Points
			) {
				object.geometry.dispose();
				(object.material as THREE.Material).dispose();
			}
		});
		for (const { glow } of this.places) glow.material.dispose();
		this.glowMap.dispose();
		this.scene.clear();
		this.renderer.dispose();
	}
}
