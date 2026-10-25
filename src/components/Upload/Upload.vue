<template>
  <section class="Upload">
    <input
      type="file"
      multiple
      :accept="UploadConfig.AcceptTypes"
      aria-label="选择图片上传"
      @change="fileListChange"
      @dragover.prevent
      @drop.prevent="handleDrop"
    />
    <div class="placeholder">
      <strong>点击选择或拖入图片</strong>
      <span>也可以粘贴图片 · 单张最大 {{ UploadConfig.MaxSize }} MB</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useToast } from '@/components/ui/toast/use-toast';
import { getAccessToken } from '@/utils/supabase';

const { toast } = useToast();
const props = defineProps(['modelValue', 'UploadConfig', 'uploadAPI']);
const emits = defineEmits(['update:modelValue']);
const UploadConfig = ref<any>(props.UploadConfig);

const fileListChange = async (v: any, type = false) => {
  let targetFileListArr: any = [];
  if (!type) {
    if (!v.target) return;
    targetFileListArr = (v.target as HTMLInputElement).files || [];
  } else {
    targetFileListArr = v;
  }

  targetFileListArr = await imgTypeFormat(targetFileListArr);
  const FileListArr: Array<any> = [...props.modelValue, ...Array.from(targetFileListArr || [])];
  let fileListFilter = FileListArr.filter(
    (i: any) =>
      UploadConfig.value.MaxSize &&
      (i.size <= UploadConfig.value.MaxSize * 1024 * 1024 || i.upload_status === 'success'),
  );

  if (fileListFilter.length !== FileListArr.length) {
    toast({ title: '提示', description: `已跳过超过 ${UploadConfig.value.MaxSize} MB 的图片` });
  }

  if (UploadConfig.value.Max && fileListFilter.length > UploadConfig.value.Max) {
    toast({ title: '提示', description: `最多上传 ${UploadConfig.value.Max} 张图片` });
    fileListFilter = Array.from(targetFileListArr || []).slice(0, UploadConfig.value.Max);
  }

  emits('update:modelValue', fileListFilter);
  fileUpload(fileListFilter);
};

const imgTypeFormat = async (files: File[]) => {
  const _fileList = Array.from(files || []);
  const convertWebPToPNG = async (file: File): Promise<File> => {
    if (!file.type.startsWith('image/webp')) return file;
    return new Promise((resolve) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          const newFile = new File([blob!], file.name.replace(/\.webp$/i, '.png'), { type: 'image/png' });
          URL.revokeObjectURL(img.src);
          resolve(newFile);
        }, 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        resolve(file);
      };
    });
  };
  return await Promise.all(_fileList.map(convertWebPToPNG));
};

const fileUpload = async (FileListArr: Array<any>) => {
  FileListArr.forEach(async (i: any) => {
    if (i.upload_status) return;
    const formData = new FormData();
    formData.append('file', i);
    if (i.type.startsWith('image/')) {
      i.upload_blob = URL.createObjectURL(i);
    }
    i.upload_status = 'uploading';
    i.upload_progress = 96;
    emits('update:modelValue', [...FileListArr]);

    try {
      const accessToken = await getAccessToken();
      const res = await fetch(props.uploadAPI, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
        body: formData,
      });
      const result = await res.json();
      if (!res.ok || result?.success === false) {
        throw new Error(result?.error || '上传失败');
      }
      i.upload_result = result;
      i.upload_result._vh_filename = i.name;
      i.upload_status = 'success';
    } catch (error) {
      i.upload_status = 'error';
      i.upload_result = error;
    } finally {
      i.upload_progress = 100;
      emits('update:modelValue', [...FileListArr]);
    }
  });
};

const handleDrop = (event: DragEvent) => {
  const files = event.dataTransfer?.files;
  if (files?.length) fileListChange(files, true);
};

const pasteUpload = (event: ClipboardEvent) => {
  const files = event.clipboardData?.files;
  if (files?.length) fileListChange(files, true);
};

onMounted(() => {
  document.addEventListener('paste', pasteUpload);
});
</script>

<style scoped lang="less">
@import 'Upload.less';
</style>
