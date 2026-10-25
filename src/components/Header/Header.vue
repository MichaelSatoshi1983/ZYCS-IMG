<template>
  <header class="Header">
    <div class="inner">
      <a href="/">{{ title }}</a>
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<style scoped lang="less">
.Header {
  position: fixed;
  z-index: 50;
  top: 0;
  left: 0;
  box-sizing: border-box;
  width: 100%;
  height: 3.5rem;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;

  .inner {
    box-sizing: border-box;
    width: 100%;
    max-width: 48rem;
    height: 100%;
    margin: 0 auto;
    padding: 0 1rem;
    display: flex;
    align-items: center;
  }

  a {
    color: #111827;
    font-size: 1rem;
    font-weight: 600;
  }
}
</style>
