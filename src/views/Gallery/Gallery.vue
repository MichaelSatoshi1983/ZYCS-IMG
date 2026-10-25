<template>
  <section class="Gallery">
    <nav class="page-nav">
      <RouterLink to="/">返回上传</RouterLink>
      <button v-if="authenticated" type="button" class="plain-button" @click="logout">退出</button>
    </nav>

    <header class="intro">
      <h1>图库管理</h1>
      <p>云端保存的图片可跨设备查看。R2 图片可删除；旧 Imgur 图片需本机保留删除凭据。</p>
    </header>

    <form v-if="!authenticated" class="login" @submit.prevent="login">
      <label for="gallery-token">管理员口令</label>
      <input
        id="gallery-token"
        v-model="loginToken"
        type="password"
        autocomplete="current-password"
        placeholder="输入管理员口令"
        required
      />
      <button type="submit" :disabled="loading">进入图库</button>
      <p v-if="message" class="message error">{{ message }}</p>
    </form>

    <template v-else>
      <p v-if="importMessage" class="message">{{ importMessage }}</p>
      <div class="toolbar">
        <span>共 {{ total }} 张图片</span>
        <button type="button" :disabled="loading" @click="loadGallery(true)">刷新</button>
      </div>

      <p v-if="message" class="message error">{{ message }}</p>
      <div v-if="images.length" class="grid">
        <article v-for="image in images" :key="image.imgur_id" class="card">
          <a :href="image.link" target="_blank" rel="noreferrer">
            <img :src="image.link" :alt="image.filename" loading="lazy" />
          </a>
          <div class="details">
            <p class="filename" :title="image.filename">{{ image.filename }}</p>
            <p class="meta">{{ formatBytes(image.size) }} · {{ formatDate(image.uploaded_at) }}</p>
            <div class="card-actions">
              <button type="button" @click="copyLink(image.link)">复制链接</button>
              <button
                type="button"
                class="delete-button"
                :disabled="deletingId === image.imgur_id"
                @click="deleteImage(image)"
              >
                {{ deletingId === image.imgur_id ? '删除中…' : '删除' }}
              </button>
            </div>
          </div>
        </article>
      </div>
      <p v-else-if="!loading && !message" class="empty">还没有图片记录。</p>

      <button
        v-if="hasMore"
        type="button"
        class="load-more"
        :disabled="loading"
        @click="loadGallery(false)"
      >
        {{ loading ? '加载中…' : '加载更多' }}
      </button>
      <p v-else-if="loading" class="empty">加载中…</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

interface GalleryImage {
  imgur_id: string;
  storage: 'r2' | 'imgur';
  filename: string;
  link: string;
  mime_type: string | null;
  size: number;
  uploaded_at: string;
}

const tokenKey = 'zycsGalleryAdminToken';
const importKey = 'zycsGalleryHistoryImported';
const token = ref('');
const loginToken = ref('');
const authenticated = ref(false);
const images = ref<GalleryImage[]>([]);
const total = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const message = ref('');
const importMessage = ref('');
const deletingId = ref('');

const logout = () => {
  sessionStorage.removeItem(tokenKey);
  token.value = '';
  loginToken.value = '';
  authenticated.value = false;
  images.value = [];
  total.value = 0;
  hasMore.value = false;
  importMessage.value = '';
};

const requestJson = async (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', 'Bearer ' + token.value);
  if (options.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    logout();
    throw new Error('管理员口令不正确或已失效');
  }
  if (!response.ok) {
    throw new Error(data.error || '请求失败，请稍后重试');
  }
  return data;
};

const importLocalHistory = async () => {
  if (sessionStorage.getItem(importKey) === 'done') return;

  let localItems: unknown[] = [];
  try {
    const saved = JSON.parse(localStorage.getItem('zychUpImageList') || '[]');
    if (Array.isArray(saved)) localItems = saved;
  } catch {
    localItems = [];
  }

  if (!localItems.length) {
    sessionStorage.setItem(importKey, 'done');
    return;
  }

  const images = localItems
    .filter((item: any) => item?.upload_status === 'success')
    .map((item: any) => {
      const data = item?.upload_result?.data || {};
      return {
        imgur_id: data.id,
        link: data.link,
        filename: item?.upload_result?._vh_filename || item?.name,
        mime_type: data.type || item?.type,
        size: data.size || item?.size,
        datetime: data.datetime,
      };
    })
    .filter((item: any) => item.imgur_id && item.link);

  if (!images.length) {
    sessionStorage.setItem(importKey, 'done');
    return;
  }

  const result = await requestJson('/api/gallery/import', {
    method: 'POST',
    body: JSON.stringify({ images }),
  });
  const count = Number(result.imported || 0);
  if (count > 0) importMessage.value = '已导入本机旧记录 ' + count + ' 条';
  sessionStorage.setItem(importKey, 'done');
};

const loadGallery = async (reset: boolean) => {
  loading.value = true;
  message.value = '';

  try {
    if (reset) {
      await importLocalHistory();
      images.value = [];
    }

    const offset = reset ? 0 : images.value.length;
    const result = await requestJson('/api/gallery?limit=48&offset=' + offset);
    const page = Array.isArray(result.images) ? result.images as GalleryImage[] : [];
    images.value = reset ? page : [...images.value, ...page];
    total.value = Number(result.total || 0);
    hasMore.value = result.nextOffset !== null && result.nextOffset !== undefined;
  } catch (error) {
    message.value = error instanceof Error ? error.message : '读取图库失败';
  } finally {
    loading.value = false;
  }
};

const login = async () => {
  if (!loginToken.value.trim()) return;
  token.value = loginToken.value.trim();
  sessionStorage.setItem(tokenKey, token.value);
  authenticated.value = true;
  await loadGallery(true);
};

const formatBytes = (value: number) => {
  if (!value) return '大小未知';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return size.toFixed(unit === 0 ? 0 : 1) + ' ' + units[unit];
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString();
};

const findLocalDeleteHash = (imageId: string) => {
  try {
    const saved = JSON.parse(localStorage.getItem('zychUpImageList') || '[]');
    if (!Array.isArray(saved)) return '';
    const item = saved.find((entry: any) => String(entry?.upload_result?.data?.id || '') === imageId);
    return String(item?.upload_result?.data?.deletehash || '');
  } catch {
    return '';
  }
};

const removeLocalHistoryRecord = (imageId: string) => {
  try {
    const saved = JSON.parse(localStorage.getItem('zychUpImageList') || '[]');
    if (!Array.isArray(saved)) return;
    const remaining = saved.filter(
      (entry: any) => String(entry?.upload_result?.data?.id || '') !== imageId,
    );
    localStorage.setItem('zychUpImageList', JSON.stringify(remaining));
  } catch {
    // The gallery deletion does not depend on local history storage.
  }
};

const deleteImage = async (image: GalleryImage) => {
  const deleteHash = image.storage === 'imgur' ? findLocalDeleteHash(image.imgur_id) : '';
  if (image.storage === 'imgur' && !deleteHash) {
    message.value = '本机未保存这张 Imgur 图片的删除凭据，无法远程删除。';
    return;
  }

  const prompt =
    image.storage === 'r2'
      ? '删除后图片会从 R2 永久移除，确定删除吗？'
      : '这会从 Imgur 永久删除图片，确定继续吗？';
  if (!window.confirm(prompt)) return;

  deletingId.value = image.imgur_id;
  message.value = '';
  try {
    await requestJson('/api/gallery/delete', {
      method: 'POST',
      body: JSON.stringify({ image_id: image.imgur_id, delete_hash: deleteHash }),
    });
    images.value = images.value.filter((item) => item.imgur_id !== image.imgur_id);
    total.value = Math.max(0, total.value - 1);
    removeLocalHistoryRecord(image.imgur_id);
    message.value = '图片已删除';
  } catch (error) {
    message.value = error instanceof Error ? error.message : '删除失败';
  } finally {
    deletingId.value = '';
  }
};

const copyLink = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    message.value = '链接已复制';
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(input);
    message.value = copied ? '链接已复制' : '复制失败，请手动复制';
  }
};

onMounted(() => {
  const savedToken = sessionStorage.getItem(tokenKey);
  if (!savedToken) return;
  token.value = savedToken;
  authenticated.value = true;
  void loadGallery(true);
});
</script>

<style scoped lang="less">
.Gallery {
  box-sizing: border-box;
  width: 100%;
  padding: 1rem 0 2rem;

  .page-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    color: #475569;
    font-size: 0.875rem;

    a:hover {
      color: #111827;
      text-decoration: underline;
    }
  }

  .intro {
    margin-bottom: 1.25rem;

    h1 {
      margin-bottom: 0.35rem;
      font-size: 1.25rem;
      font-weight: 600;
    }

    p {
      margin: 0;
      color: #6b7280;
      font-size: 0.875rem;
      line-height: 1.5;
    }
  }

  .login {
    display: grid;
    gap: 0.75rem;
    width: min(100%, 24rem);

    label {
      font-size: 0.9rem;
    }

    input {
      box-sizing: border-box;
      width: 100%;
      padding: 0.65rem 0.75rem;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: #fff;
    }
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
    color: #475569;
    font-size: 0.875rem;
  }

  button {
    padding: 0.45rem 0.75rem;
    color: #111827;
    background: #f8fafc;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: #f1f5f9;
    }

    &:disabled {
      color: #9ca3af;
      cursor: not-allowed;
    }
  }

  .plain-button {
    padding: 0;
    border: 0;
    background: transparent;
    color: #475569;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.75rem;
  }

  .card {
    overflow: hidden;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: #fff;

    > a {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 10rem;
      background: #f8fafc;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  }

  .details {
    padding: 0.65rem;

    p {
      margin: 0;
    }
  }

  .card-actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.6rem;

    button {
      flex: 1;
      margin: 0;
      padding: 0.4rem 0.25rem;
      font-size: 0.8rem;
    }

    .delete-button {
      color: #b91c1c;
      border-color: #fecaca;
      background: #fff;
    }

    .delete-button:hover:not(:disabled) {
      background: #fef2f2;
    }
  }

  .filename {
    overflow: hidden;
    font-size: 0.875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    margin-top: 0.3rem !important;
    color: #6b7280;
    font-size: 0.75rem;
  }

  .message,
  .empty {
    margin: 0.75rem 0;
    color: #475569;
    font-size: 0.875rem;
  }

  .error {
    color: #b91c1c;
  }

  .load-more {
    display: block;
    margin: 1rem auto 0;
  }
}

@media screen and (max-width: 520px) {
  .Gallery .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .Gallery .card > a {
    height: 8rem;
  }
}
</style>
