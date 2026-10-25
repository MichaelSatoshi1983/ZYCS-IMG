<template>
  <Header title="图床" />
  <main class="w-full max-w-3xl">
    <RouterView />
  </main>
  <Toaster />
</template>

<script setup lang="ts">
import Header from '@/components/Header/Header.vue';
import { Toaster } from '@/components/ui/toast';
</script>
