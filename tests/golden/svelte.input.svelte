<script context="module">export const answer=()=>({value:42});</script>

<script lang="ts">
let count:number=0;
const settings={enabled:true,nested:{value:1}};
function increment(){count+=1;return count;}
</script>

<svelte:head><title>Keep   this</title></svelte:head>
<button class="px-2   py-1" onclick={() => count+=1}>{count+1}</button>

<section>
{#if count>0}<Widget class="md:flex   hidden" title="value   {count+1}" {...settings} />{:else if count===0}<!-- keep   this -->

{@const doubled=count*2}{@debug doubled,count}<p>Zero {doubled}</p>{:else}<p>Negative</p>{/if}
</section>

<Button
onclick={(event)=>{event.preventDefault();increment()}}
class="one   two"
>Increment</Button>

<style>
.button{color:red;  padding:0}
</style>
