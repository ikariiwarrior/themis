<script context="module">
    export const answer = () => ( {
        value: 42
    } );
</script>

<script lang="ts">
    let count: number = 0;

    const settings = {
        enabled: true,
        nested: {
            value: 1
        }
    };

    function increment() {
        count += 1;

        return count;
    }
</script>

<svelte:head><title>Keep   this</title></svelte:head>
<button class="px-2   py-1" onclick={() => count+=1}>{count+1}</button>

<style>
    .button {
        color: red;
        padding: 0;
    }
</style>
