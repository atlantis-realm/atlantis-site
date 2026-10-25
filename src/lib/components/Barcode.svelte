<script lang="ts">
    // [margin, width] for each line, left to right
    const bodyLines = [
        [0, 8], [4, 8], [4, 16], [4, 12], [10, 12], [10, 6], [4, 6], [20, 6], [10, 12],
        [10, 6], [20, 6], [4, 6], [10, 12], [10, 6], [4, 6], [4, 6], [4, 6], [4, 16],
        [10, 6], [10, 6], [14, 6], [4, 16], [10, 12], [10, 12], [4, 16], [4, 6], [4, 16]
    ];
    const armLines = [[4, 6], [4, 6], [4, 6]];
    const lastIndex = bodyLines.length + armLines.length - 1;

    // how far a line is from the middle, so the jump ripples outwards
    const distanceFromMiddle = (i: number) => Math.abs(i - lastIndex / 2);

    let jumping = $state(false);

    // let the jump finish even if the cursor leaves early
    function onanimationend(e: AnimationEvent) {
        if ((e.target as HTMLElement).dataset.last) jumping = false;
    }
</script>

<div class="barcode" class:jumping onmouseenter={() => (jumping = true)} {onanimationend} role="img" aria-label="Barcode creature">
    <div class="eyes">
        <svg width="60" height="34" viewBox="0 0 60 34" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.12109 31.7427L29.6211 4.24268L57.1211 31.7427" stroke-width="6" stroke="white"/>
        </svg>

        <svg width="60" height="34" viewBox="0 0 60 34" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.12109 31.7427L29.6211 4.24268L57.1211 31.7427" stroke-width="6" stroke="white"/>
        </svg>
    </div>
    <div class="barcode__body">
        {#each bodyLines as [margin, width], i}
            <div
                class="body-line"
                style="margin-left: {margin}px; width: {width}px; --d: {distanceFromMiddle(i)}"
            ></div>
        {/each}
        <!-- the arm is the last thing to finish, so it ends the jump -->
        <div class="barcode__arm" data-last="true">
            {#each armLines as [margin, width], j}
                {@const i = bodyLines.length + j}
                <div
                    class="body-line"
                    style="margin-left: {margin}px; width: {width}px; --d: {distanceFromMiddle(i)}"
                ></div>
            {/each}
        </div>
    </div>
</div>


<style>
.eyes{
 text-align: start;
 margin-left: 36px;
 display: flex;
 gap: 150px;
}

.barcode__body{
    display: flex;
    margin-top: 10px
}

.barcode__arm{
    display: flex;
    /* centered horizontally, 20px up from the bottom */
    transform-origin: 50% calc(100% - 20px);
}

.body-line{
    background-color: white;
    height: 200px;
}

/* eyes hop as one unit, a little higher than the body */
.jumping .eyes{
    animation: jump 0.5s ease-out;
    --jump-height: -36px;
}

/* each line hops on its own, delayed by distance from the middle to make a wave */
.jumping .body-line{
    animation: jump 0.45s ease-out calc(var(--d) * 25ms) backwards;
    --jump-height: -24px;
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
        transform: translateY(-140px) rotate(0deg);
    }
    43.7%, 53.1%, 62.5%, 71.9%, 81.3%{
        transform: translateY(-140px) rotate(-14deg);
    }
    48.4%, 57.8%, 67.2%, 76.6%, 86%{
        transform: translateY(-140px) rotate(14deg);
    }
    90%{
        transform: translateY(-140px) rotate(0deg);
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
