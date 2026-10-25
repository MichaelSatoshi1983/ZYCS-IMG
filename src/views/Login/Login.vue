<template>
  <section class="Login">
    <header>
      <h1>图床登录</h1>
      <p>仅指定邮箱可以注册；登录后可上传、查看和管理图片。</p>
    </header>

    <form @submit.prevent="submit">
      <label for="auth-email">邮箱</label>
      <input
        id="auth-email"
        v-model="email"
        type="email"
        autocomplete="username"
        placeholder="name@example.com"
        required
      />

      <label for="auth-password">密码</label>
      <input
        id="auth-password"
        v-model="password"
        type="password"
        :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
        minlength="8"
        required
      />

      <button type="submit" :disabled="loading">
        {{ loading ? '请稍候…' : mode === 'login' ? '登录' : '创建账号' }}
      </button>
    </form>

    <button class="mode-button" type="button" :disabled="loading" @click="toggleMode">
      {{ mode === 'login' ? '首次使用？创建管理员账号' : '已有账号？返回登录' }}
    </button>

    <p v-if="message" class="message" :class="{ error }" role="status">{{ message }}</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getSupabase, verifyOwnerSession } from '@/utils/supabase';

const route = useRoute();
const router = useRouter();
const email = ref('');
const password = ref('');
const mode = ref<'login' | 'register'>('login');
const loading = ref(false);
const message = ref('');
const error = ref(false);

const destination = () => {
  const next = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
};

const toggleMode = () => {
  mode.value = mode.value === 'login' ? 'register' : 'login';
  message.value = '';
  error.value = false;
};

const submit = async () => {
  loading.value = true;
  message.value = '';
  error.value = false;

  try {
    const normalizedEmail = email.value.trim().toLowerCase();
    const supabase = await getSupabase();

    if (mode.value === 'register') {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password: password.value }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '创建账号失败');

      mode.value = 'login';
      password.value = '';
      message.value = '如果邮箱获准注册，确认邮件会发送到该邮箱；完成验证后直接登录。已有账号请登录。';
      return;
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: password.value,
      });
      if (signInError) throw signInError;
    }

    const user = await verifyOwnerSession();
    if (!user) {
      throw new Error('此账号未获准管理该图床');
    }

    await router.replace(destination());
  } catch (cause) {
    error.value = true;
    message.value = cause instanceof Error ? cause.message : '登录失败，请稍后重试';
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  try {
    if (await verifyOwnerSession()) await router.replace(destination());
  } catch {
    // Keep the sign-in form available while the auth service is unavailable.
  }
});
</script>

<style scoped lang="less">
.Login {
  box-sizing: border-box;
  width: min(100%, 24rem);
  margin: 10vh auto 0;
  padding: 1.25rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;

  header {
    margin-bottom: 1.25rem;
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 600;
  }

  header p {
    margin: 0.4rem 0 0;
    color: #6b7280;
    font-size: 0.875rem;
  }

  form {
    display: grid;
    gap: 0.65rem;
  }

  label {
    font-size: 0.875rem;
  }

  input {
    box-sizing: border-box;
    width: 100%;
    padding: 0.65rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 4px;
  }

  button {
    padding: 0.6rem 0.75rem;
    border: 1px solid #111827;
    border-radius: 4px;
    background: #111827;
    color: #fff;
    cursor: pointer;

    &:disabled {
      opacity: 0.6;
      cursor: wait;
    }
  }

  .mode-button {
    margin-top: 0.8rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: #475569;
    font-size: 0.875rem;
  }

  .message {
    margin: 0.9rem 0 0;
    color: #166534;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .message.error {
    color: #b91c1c;
  }
}
</style>
