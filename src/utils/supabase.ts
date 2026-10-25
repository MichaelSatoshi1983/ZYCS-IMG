import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

interface AuthConfig {
  url: string;
  publishableKey: string;
}

let clientPromise: Promise<SupabaseClient> | null = null;

export const getSupabase = async (): Promise<SupabaseClient> => {
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch('/api/auth/config', { cache: 'no-store' });
      const config = (await response.json().catch(() => ({}))) as Partial<AuthConfig>;

      if (!response.ok || !config.url || !config.publishableKey) {
        throw new Error('登录服务暂不可用');
      }

      return createClient(config.url, config.publishableKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      });
    })();
  }

  try {
    return await clientPromise;
  } catch (error) {
    clientPromise = null;
    throw error;
  }
};

export const getAccessToken = async (): Promise<string> => {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;
  if (!data.session) throw new Error('请先登录');

  let session = data.session;
  if (session.expires_at && session.expires_at <= Math.floor(Date.now() / 1000) + 60) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      throw refreshed.error || new Error('登录已失效，请重新登录');
    }
    session = refreshed.data.session;
  }

  return session.access_token;
};

export const verifyOwnerSession = async (): Promise<User | null> => {
  const supabase = await getSupabase();
  const token = await getAccessToken();
  const response = await fetch('/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store',
  });

  if (response.status === 401 || response.status === 403) {
    await supabase.auth.signOut();
    sessionStorage.removeItem('zycsGalleryAdminToken');
    return null;
  }
  if (!response.ok) throw new Error('登录验证暂不可用');

  const data = (await response.json().catch(() => ({}))) as { user?: User };
  if (!data.user) return null;
  sessionStorage.removeItem('zycsGalleryAdminToken');
  return data.user;
};

