<script lang="ts">
    // [margin, width] for each line, left to right
    const bodyLines = [
        [0, 8], [4, 8], [4, 16], [4, 12], [10, 12], [10, 6], [4, 6], [20, 6], [10, 12],
        [10, 6], [20, 6], [4, 6], [10, 12], [10, 6], [4, 6], [4, 6], [4, 6], [4, 16],
        [10, 6], [10, 6], [14, 6], [4, 16], [10, 12], [10, 12], [4, 16], [4, 6], [4, 16]
    ];
    const armLines = [[4, 6], [4, 6], [4, 6]];

    // everything below is in viewBox units, so the whole creature scales with the space it's given
    const LINE_HEIGHT = 200;
    const EYE = { width: 60, height: 34, gap: 150, inset: 36 };
    const EYE_BODY_GAP = 10;
    const ARM_PIVOT_INSET = 20; // how far up from the bottom of the arm it pivots
    const ARM_LIFT = 140;
    const JUMP_HEIGHT = { eyes: 36, body: 24 };

    const lastIndex = bodyLines.length + armLines.length - 1;

    // how far a line is from the middle, so the jump ripples outwards
    const distanceFromMiddle = (i: number) => Math.abs(i - lastIndex / 2);

    // turn [margin, width] pairs into absolute positions, starting at `from`
    function layout(lines: number[][], from: number, firstIndex: number) {
        let x = from;
        return lines.map(([margin, width], j) => {
            x += margin;
            const line = { x, width, d: distanceFromMiddle(firstIndex + j) };
            x += width;
            return line;
        });
    }

    const body = layout(bodyLines, 0, 0);
    const bodyEnd = body[body.length - 1].x + body[body.length - 1].width;
    const arm = layout(armLines, bodyEnd, bodyLines.length);
    const armEnd = arm[arm.length - 1].x + arm[arm.length - 1].width;

    const eyeXs = [EYE.inset, EYE.inset + EYE.width + EYE.gap];
    const eyesEnd = eyeXs[1] + EYE.width;

    const bodyTop = EYE.height + EYE_BODY_GAP;
    const viewWidth = Math.max(armEnd, eyesEnd);
    const viewHeight = bodyTop + LINE_HEIGHT;

    // the arm pivots about its horizontal middle, a little above the bottom
    const armPivot = { x: (bodyEnd + armEnd) / 2, y: viewHeight - ARM_PIVOT_INSET };

    let jumping = $state(false);

    // let the jump finish even if the cursor leaves early
    function onanimationend(e: AnimationEvent) {
        if ((e.target as SVGElement).dataset.last) jumping = false;
    }
</script>

<svg
    class="barcode"
    class:jumping
    viewBox="0 0 {viewWidth} {viewHeight}"
    style="max-width: {viewWidth}px; --jump-eyes: -{JUMP_HEIGHT.eyes}px; --jump-body: -{JUMP_HEIGHT.body}px; --arm-lift: -{ARM_LIFT}px"
    onmouseenter={() => (jumping = true)}
    {onanimationend}
    role="img"
    aria-label="Barcode creature"
>
    <g class="eyes">
        {#each eyeXs as x (x)}
            <path
                d="M2.12109 31.7427L29.6211 4.24268L57.1211 31.7427"
                transform="translate({x} 0)"
                fill="none"
                stroke="white"
                stroke-width="6"
            />
        {/each}
    </g>

    {#each body as { x, width, d } (x)}
        <rect class="body-line" {x} y={bodyTop} {width} height={LINE_HEIGHT} style="--d: {d}" />
    {/each}

    <!-- the arm is the last thing to finish, so it ends the jump -->
    <g class="barcode__arm" data-last="true" style="transform-origin: {armPivot.x}px {armPivot.y}px">
        {#each arm as { x, width, d } (x)}
            <rect class="body-line" {x} y={bodyTop} {width} height={LINE_HEIGHT} style="--d: {d}" />
        {/each}
    </g>
</svg>


<style>
.barcode{
    display: block;
    width: 100%;
    height: auto;
    /* the eyes and arm jump above the drawing, so don't clip them */
    overflow: visible;
}

.body-line{
    fill: white;
}

/* eyes hop as one unit, a little higher than the body */
.jumping .eyes{
    animation: jump 0.5s ease-out;
    --jump-height: var(--jump-eyes);
}

/* each line hops on its own, delayed by distance from the middle to make a wave */
.jumping .body-line{
    animation: jump 0.45s ease-out calc(var(--d) * 25ms) backwards;
    --jump-height: var(--jump-body);
}

/* starts about halfway through the wave: raises, holds for 0.5s, then waves side to side 10 times */
.jumping .barcode__arm{
    animation: arm-wave 1.7s ease-in-out 0.4s backwards;
}

@keyframes arm-wave{
    0%{
        transform: translateY(0) rotate(0deg);
    }
    10%, 39%{
        transform: translateY(var(--arm-lift)) rotate(0deg);
    }
    43.7%, 53.1%, 62.5%, 71.9%, 81.3%{
        transform: translateY(var(--arm-lift)) rotate(-14deg);
    }
    48.4%, 57.8%, 67.2%, 76.6%, 86%{
        transform: translateY(var(--arm-lift)) rotate(14deg);
    }
    90%{
        transform: translateY(var(--arm-lift)) rotate(0deg);
    }
    100%{
        transform: translateY(0) rotate(0deg);
    }
}

@keyframes jump{
    0%, 100%{
        transform: translateY(0);
    }
    40%{
        transform: translateY(var(--jump-height));
    }
    70%{
        transform: translateY(0);
    }
    85%{
        transform: translateY(calc(var(--jump-height) * 0.2));
    }
}

@media (prefers-reduced-motion: reduce){
    .jumping .eyes,
    .jumping .barcode__arm,
    .jumping .body-line{
        animation: none;
    }
}
</style>
