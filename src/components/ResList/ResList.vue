<template>
  <section class="ResList">
    <article class="item" v-for="(i, idx) in props.modelValue" :key="idx">
      <img
        v-if="i.upload_blob"
        class="thumb"
        :src="i.upload_status === 'success' ? i.upload_blob : LoadingImg"
        alt=""
      />

      <div class="result-content">
        <template v-if="i.upload_status === 'success'">
          <div class="row">
            <span>URL</span>
            <input
              :value="formatURL(props, i.upload_result)"
              type="text"
              readonly
              aria-label="图片链接，点击复制"
              @click="copyCodeValue(formatURL(props, i.upload_result))"
            />
            <button type="button" @click="copyCodeValue(formatURL(props, i.upload_result))">复制</button>
          </div>
          <div class="row">
            <span>Markdown</span>
            <input
              :value="formatURL(props, i.upload_result, 'md')"
              type="text"
              readonly
              aria-label="Markdown 链接，点击复制"
              @click="copyCodeValue(formatURL(props, i.upload_result, 'md'))"
            />
            <button type="button" @click="copyCodeValue(formatURL(props, i.upload_result, 'md'))">复制</button>
          </div>
        </template>
        <p v-else-if="i.upload_status === 'uploading'" class="status">上传中…</p>
        <p v-else-if="i.upload_status === 'error'" class="status">上传失败</p>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { formatURL } from '@/utils/index';
import { useToast } from '@/components/ui/toast/use-toast';
import LoadingImg from '@/assets/images/loading.gif';

const { toast } = useToast();
const props = defineProps(['modelValue', 'nodeHost']);

const copyCodeValue = async (value: string) => {
  let copied = false;
  try {
    await navigator.clipboard.writeText(value);
    copied = true;
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    document.body.appendChild(input);
    input.select();
    copied = document.execCommand('copy');
    document.body.removeChild(input);
  }

  if (copied) toast({ title: '提示', description: '已复制' });
};
</script>

<style scoped lang="less">
@import 'ResList.less';
</style>
