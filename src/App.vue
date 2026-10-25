<template>
  <main class="w-full max-w-3xl">
    <RouterView />
  </main>
  <Toaster />
</template>

<script setup lang="ts">
import { Toaster } from '@/components/ui/toast';
</script>
