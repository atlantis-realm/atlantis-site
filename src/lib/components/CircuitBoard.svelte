<script lang="ts">
    // everything below is in viewBox units, so the board scales with the space it's given
    const WIDTH = 400;
    const HEIGHT = 240;
    const PAD_RADIUS = 6;
    const HOLE_RADIUS = 5;
    const HOLE_INSET = 20;

    const chip = { x: 150, y: 80, width: 100, height: 80 };
    const PIN_LENGTH = 10;

    // traces run from a chip pin out to a pad on the left; the right side is a mirror image
    const pinYs = [105, 120, 135];
    const leftTraces = [
        [[140, 105], [110, 105], [90, 85], [40, 85]],
        [[140, 120], [40, 120]],
        [[140, 135], [110, 135], [90, 155], [40, 155]]
    ];

    const mirror = (points: number[][]) => points.map(([x, y]) => [WIDTH - x, y]);
    const toPoints = (points: number[][]) => points.map((p) => p.join(' ')).join(' ');

    const traces = [...leftTraces, ...leftTraces.map(mirror)].map(toPoints);

    // each trace ends in a pad
    const pads = [...leftTraces, ...leftTraces.map(mirror)].map((t) => {
        const [cx, cy] = t[t.length - 1];
        return { cx, cy };
    });

    // a trace plus the pin joining it to the chip edge, running chip -> pad
    const toPad = (t: number[][]) => [[chip.x, t[0][1]], ...t];
    const fromChip = leftTraces.map(toPad);
    const chipToPad = [...fromChip, ...fromChip.map(mirror)];

    // beams go chip -> pad; pulses go the other way, pad -> chip
    const beams = chipToPad.map(toPoints);
    const pulses = chipToPad.map((p) => toPoints([...p].reverse()));

    // charging: pulses step the chip's glow up. ready: at full glow, waiting for a click.
    // sending: beams grow chip -> pads. holding: beams stay lit for HOLD_MS.
    // draining: beams and glow fade from the chip side. resting: everything dark for REST_MS, then it restarts
    const HOLD_MS = 2000;
    const REST_MS = 1000;
    let phase = $state<'charging' | 'ready' | 'sending' | 'holding' | 'draining' | 'resting'>(
        'charging'
    );

    function send() {
        if (phase === 'ready') phase = 'sending';
    }

    // svelte prefixes keyframe names with a hash (e.g. "svelte-abc123-charge"), so match the end
    const finished = (e: AnimationEvent, name: string) => e.animationName.endsWith(`-${name}`);

    function onanimationend(e: AnimationEvent) {
        if (phase === 'charging' && finished(e, 'charge')) phase = 'ready';
        else if (phase === 'sending' && finished(e, 'extend')) {
            phase = 'holding';
            setTimeout(() => (phase = 'draining'), HOLD_MS);
        }
        else if (phase === 'draining' && finished(e, 'retract')) {
            phase = 'resting';
            setTimeout(() => (phase = 'charging'), REST_MS);
        }
    }

    const pins = pinYs.flatMap((y) => [
        { x1: chip.x - PIN_LENGTH, x2: chip.x, y },
        { x1: chip.x + chip.width, x2: chip.x + chip.width + PIN_LENGTH, y }
    ]);

    const holes = [
        { cx: HOLE_INSET, cy: HOLE_INSET },
        { cx: WIDTH - HOLE_INSET, cy: HOLE_INSET },
        { cx: HOLE_INSET, cy: HEIGHT - HOLE_INSET },
        { cx: WIDTH - HOLE_INSET, cy: HEIGHT - HOLE_INSET }
    ];
</script>

<svg
    class="circuit-board"
    class:ready={phase === 'ready'}
    class:sending={phase === 'sending'}
    class:holding={phase === 'holding'}
    class:draining={phase === 'draining'}
    class:resting={phase === 'resting'}
    viewBox="0 0 {WIDTH} {HEIGHT}"
    role="button"
    tabindex="0"
    aria-label="Circuit board"
    onclick={send}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && send()}
    {onanimationend}
>
    <rect class="outline" x="2" y="2" width={WIDTH - 4} height={HEIGHT - 4} rx="10" />

    {#each holes as { cx, cy } (`${cx}-${cy}`)}
        <circle class="outline thin" {cx} {cy} r={HOLE_RADIUS} />
    {/each}

    <rect class="outline glow" x={chip.x} y={chip.y} width={chip.width} height={chip.height} rx="4" />

    <!-- raidho rune etched into the chip, centred on it -->
    <path class="outline rune glow" d="M188 148 V92 L213 111 L188 131 L213 148" />

    {#each pins as { x1, x2, y } (`${x1}-${y}`)}
        <line class="outline thin" {x1} {x2} y1={y} y2={y} />
    {/each}

    {#each traces as points (points)}
        <polyline class="outline thin" {points} />
    {/each}

    {#each pulses as points, i (points)}
        <polyline class="pulse" {points} pathLength="100" style="animation-delay: {i * 0.35}s" />
    {/each}

    {#each beams as points (points)}
        <polyline class="beam" {points} pathLength="100" />
    {/each}

    {#each pads as { cx, cy } (`${cx}-${cy}`)}
        <circle class="outline pad" {cx} {cy} r={PAD_RADIUS} />
    {/each}
</svg>

<style>
.circuit-board{
    display: block;
    width: 100%;
    height: auto;
}

.outline{
    fill: none;
    stroke: white;
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-linecap: round;
}

.thin{
    stroke-width: 2;
}

/* lights up the same way as the chip when a beam reaches it (see --charge below) */
.pad{
    fill: color-mix(in srgb, #e3d1ff min(calc(var(--charge) * 100%), 100%), white);
    stroke: color-mix(in srgb, #e3d1ff min(calc(var(--charge) * 100%), 100%), white);
    /* up to --charge 1 this matches the chip. Past 1 the halos grow with the square of it, and
       two extra shadows (a second violet layer and a white-hot core) fade in on top */
    filter:
        drop-shadow(0 0 calc(var(--charge) * var(--charge) * 4px) rgb(179 136 255 / var(--charge)))
        drop-shadow(0 0 calc(var(--charge) * var(--charge) * 12px) rgb(124 77 255 / var(--charge)))
        drop-shadow(0 0 calc(var(--charge) * var(--charge) * 6px) rgb(179 136 255 / calc(var(--charge) - 1)))
        drop-shadow(0 0 calc(var(--charge) * 2px) rgb(255 255 255 / calc(var(--charge) - 1)));
}

.rune{
    stroke-width: 4;
    stroke-linejoin: miter;
    stroke-linecap: butt;
}

/* a short bright dash that runs along the trace, from the pad to the chip */
.pulse{
    fill: none;
    stroke: #b388ff;
    stroke-width: 5;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 10 100;
    filter: drop-shadow(0 0 3px #b388ff) drop-shadow(0 0 8px #7c4dff);
    animation: flow 2s linear infinite backwards;
}

/* 0 = unlit, 1 = full glow; animating it as a number lets the keyframes step it up */
@property --charge{
    syntax: '<number>';
    inherits: false;
    initial-value: 0;
}

.glow{
    stroke: color-mix(in srgb, #e3d1ff calc(var(--charge) * 100%), white);
    filter:
        drop-shadow(0 0 calc(var(--charge) * 4px) rgb(179 136 255 / var(--charge)))
        drop-shadow(0 0 calc(var(--charge) * 12px) rgb(124 77 255 / var(--charge)));
    /* one step up per pulse. The six pulses arrive at 1.82s + 0.35s * n (see .pulse), and the
       steps are timed to match: 1.7s delay + 1.9s duration. Holds at full glow after the last */
    animation: charge 1.9s ease-out 1.7s both;
}

@keyframes charge{
    0%, 1.3%{ --charge: 0; }
    6.3%, 19.7%{ --charge: 0.1667; }
    24.7%, 38.2%{ --charge: 0.3333; }
    43.2%, 56.6%{ --charge: 0.5; }
    61.6%, 75%{ --charge: 0.6667; }
    80%, 93.4%{ --charge: 0.8333; }
    98.4%, 100%{ --charge: 1; }
}

.circuit-board.ready{
    cursor: pointer;
}

/* clicked: the pulses stop and the chip holds full glow while the beams reach the pads */
.sending .pulse,
.holding .pulse,
.draining .pulse,
.resting .pulse{
    display: none;
}

/* dark and still for a moment before the cycle starts again */
.resting .glow{
    animation: none;
}

.sending .glow,
.holding .glow{
    --charge: 1;
    animation: none;
}

.draining .glow{
    animation: discharge 0.9s ease-in both;
}

/* a continuous line, hidden until it's sent */
.beam{
    display: none;
    fill: none;
    stroke: #b388ff;
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-dasharray: 100 100;
    filter: drop-shadow(0 0 3px #b388ff) drop-shadow(0 0 8px #7c4dff);
}

.sending .beam,
.holding .beam{
    display: inline;
    animation: extend 0.9s ease-in-out both;
}

/* retracts from the chip end first, in step with the chip's glow fading */
.draining .beam{
    display: inline;
    animation: retract 0.9s ease-in both;
}

/* the pads flare just as the beams (0.9s) arrive */
.sending .pad,
.holding .pad{
    animation: light 2.2s ease-out 0.75s both;
}

/* the pads stay at full brightness until the beams have finished retracting; the draining phase
   then ends, which snaps them (and the restarted cycle) back to unlit */
.draining .pad{
    --charge: 2;
    animation: none;
}

/* flares to full glow as the beam arrives (0.2s in), then keeps brightening past the chip's glow through the hold */
@keyframes light{
    0%{
        --charge: 0;
    }
    9%{
        --charge: 1;
    }
    100%{
        --charge: 2;
    }
}

@keyframes extend{
    from{
        stroke-dashoffset: 100;
    }
    to{
        stroke-dashoffset: 0;
    }
}

@keyframes retract{
    from{
        stroke-dashoffset: 0;
    }
    to{
        stroke-dashoffset: -100;
    }
}

@keyframes discharge{
    from{
        --charge: 1;
    }
    to{
        --charge: 0;
    }
}

@keyframes flow{
    from{
        stroke-dashoffset: 10;
    }
    to{
        stroke-dashoffset: -100;
    }
}

@media (prefers-reduced-motion: reduce){
    .glow,
    .beam,
    .pulse{
        animation: none;
        display: none;
    }
}
</style>
