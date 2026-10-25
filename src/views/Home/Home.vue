<template>
  <section class="Home">
    <nav class="home-nav">
      <RouterLink to="/gallery">图库管理</RouterLink>
    </nav>

    <div class="intro">
      <h1>上传图片</h1>
      <p>支持常见图片格式，单张最大 15 MB。可点击选择、拖入或粘贴图片。</p>
    </div>

    <Upload v-model="fileList" :UploadConfig="UploadConfig" :uploadAPI="uploadAPI" />

    <section v-if="fileList.length" class="vh-tools">
      <span>{{ fileList.length }} 张图片</span>
      <div class="actions">
        <button type="button" :disabled="!copyableLinks" @click="copyAll">复制全部链接</button>
        <button type="button" @click="fileList = []">清空本页记录</button>
      </div>
    </section>

    <ResList v-model="fileList" :nodeHost="nodeHost" />
  </section>
</template>

<script setup lang="ts">
import vh from 'vh-plugin';
import { computed, ref, watch } from 'vue';
import { formatURL } from '@/utils/index';
import Upload from '@/components/Upload/Upload.vue';
import ResList from '@/components/ResList/ResList.vue';

const nodeHost = ref<string>(import.meta.env.VITE_IMG_API_URL || location.origin);
const uploadAPI = ref<string>(`${import.meta.env.VITE_IMG_API_URL || location.origin}/upload`);
const UploadConfig = ref<any>({
  AcceptTypes: 'image/*',
  Max: 0,
  MaxSize: 15,
});
const fileList = ref<Array<any>>(JSON.parse(localStorage.getItem('zychUpImageList') || '[]'));

const copyableLinks = computed(() =>
  fileList.value
    .filter((item: any) => item.upload_status === 'success')
    .map((item: any) => item.upload_blob)
    .filter(Boolean)
    .join(String.fromCharCode(10)),
);

const copyAll = () => {
  if (copyableLinks.value) vh.CopyText(copyableLinks.value);
};

watch(fileList, (newVal) => {
  localStorage.setItem(
    'zychUpImageList',
    JSON.stringify(
      newVal
        .filter((item: any) => item.upload_status === 'success')
        .map((item: any) => {
          item.upload_blob = formatURL({ nodeHost: nodeHost.value }, item.upload_result);
          return item;
        }),
    ),
  );
});
</script>

<style scoped lang="less">
@import 'Home.less';
</style>
