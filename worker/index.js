import { onRequestGet as proxyCachedImage } from "../functions/v2/[vkey].js";
import { onRequestGet as proxyImgurImage } from "../functions/vh-img-proxy/[vkey].js";

const MAX_IMAGE_SIZE = 15 * 1024 * 1024;

const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const methodNotAllowed = (allow) =>
  new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: allow },
  });

const validImgurLink = (value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["i.imgur.com", "imgur.com", "www.imgur.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

const normalizeImage = (record) => {
  const data = record?.upload_result?.data || record?.data || record;
  const imgurId = String(data?.id || record?.imgur_id || "").trim();
  const link = String(data?.link || record?.link || "").trim();

  if (!/^[a-zA-Z0-9]{1,64}$/.test(imgurId) || !validImgurLink(link)) {
    return null;
  }

  const filename = String(
    record?.upload_result?._vh_filename || record?.filename || record?.name || imgurId,
  )
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, 255) || imgurId;
  const type = String(data?.type || record?.mime_type || record?.type || "").slice(0, 100);
  const rawSize = Number(data?.size ?? record?.size ?? 0);
  const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(Math.floor(rawSize), 100000000) : 0;

  let uploadedAt = new Date().toISOString();
  const timestamp = Number(data?.datetime);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    uploadedAt = new Date(timestamp * 1000).toISOString();
  } else if (record?.uploaded_at && Number.isFinite(Date.parse(record.uploaded_at))) {
    uploadedAt = new Date(record.uploaded_at).toISOString();
  }

  return {
    imgur_id: imgurId,
    filename,
    link,
    mime_type: type,
    size,
    uploaded_at: uploadedAt,
  };
};

const authConfigUnavailable = (env) =>
  !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.GALLERY_OWNER_EMAIL;

const getAuthConfig = (request, env) => {
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return jsonResponse({ error: "登录服务暂不可用" }, 503);
  }

  return jsonResponse({
    url: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
  });
};

const signUpOwner = async (request, env) => {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (authConfigUnavailable(env)) return jsonResponse({ error: "登录服务暂未配置" }, 503);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "注册信息格式不正确" }, 400);
  }

  const email = String(payload?.email || "").trim().toLowerCase();
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (password.length < 8 || password.length > 128) {
    return jsonResponse({ error: "密码长度需为 8 到 128 个字符" }, 400);
  }

  const ownerEmail = String(env.GALLERY_OWNER_EMAIL).trim().toLowerCase();
  if (!email || email !== ownerEmail) {
    return jsonResponse({ accepted: true }, 202);
  }

  try {
    const supabaseResponse = await fetch(new URL("/auth/v1/signup", env.SUPABASE_URL), {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    await supabaseResponse.arrayBuffer();

    if (!supabaseResponse.ok) {
      if (supabaseResponse.status >= 500) {
        return jsonResponse({ error: "注册服务暂不可用，请稍后重试" }, 503);
      }
      // Keep existing-user and other Auth responses indistinguishable from unapproved emails.
      return jsonResponse({ accepted: true }, 202);
    }

    return jsonResponse({ accepted: true }, 202);
  } catch (error) {
    console.error("Supabase owner signup failed", error);
    return jsonResponse({ error: "注册服务暂不可用，请稍后重试" }, 503);
  }
};

const authenticateOwner = async (request, env) => {
  if (authConfigUnavailable(env)) {
    return { ok: false, response: jsonResponse({ error: "登录服务暂未配置" }, 503) };
  }

  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(authorization);
  if (!match) {
    return { ok: false, response: jsonResponse({ error: "请先登录" }, 401) };
  }

  try {
    const response = await fetch(new URL("/auth/v1/user", env.SUPABASE_URL), {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: "Bearer " + match[1],
      },
    });
    if (response.status === 401) {
      return { ok: false, response: jsonResponse({ error: "登录已失效，请重新登录" }, 401) };
    }
    if (!response.ok) {
      return { ok: false, response: jsonResponse({ error: "登录验证暂不可用" }, 503) };
    }

    const user = await response.json();
    const ownerEmail = String(env.GALLERY_OWNER_EMAIL).trim().toLowerCase();
    const userEmail = String(user?.email || "").trim().toLowerCase();

    if (!user?.id || !userEmail) {
      return { ok: false, response: jsonResponse({ error: "Supabase 用户信息无效" }, 401) };
    }
    if (!user.email_confirmed_at) {
      return { ok: false, response: jsonResponse({ error: "请先完成邮箱验证" }, 403) };
    }
    if (userEmail !== ownerEmail) {
      return { ok: false, response: jsonResponse({ error: "此账号没有图床管理权限" }, 403) };
    }

    return { ok: true, user: { id: user.id, email: user.email } };
  } catch (error) {
    console.error("Supabase user verification failed", error);
    return { ok: false, response: jsonResponse({ error: "登录验证暂不可用" }, 503) };
  }
};

const getCurrentOwner = async (request, env) => {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const auth = await authenticateOwner(request, env);
  if (!auth.ok) return auth.response;
  return jsonResponse({ user: auth.user });
};

const galleryUnavailable = (env) =>
  !env.GALLERY_DB || !env.IMAGE_BUCKET || authConfigUnavailable(env)
    ? jsonResponse({ error: "图床管理暂不可用" }, 503)
    : null;

const listGallery = async (request, env) => {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const unavailable = galleryUnavailable(env);
  if (unavailable) return unavailable;
  const auth = await authenticateOwner(request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "48", 10);
  const requestedOffset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 48;
  const offset = Number.isFinite(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 10000000) : 0;

  try {
    const count = await env.GALLERY_DB.prepare(
      "SELECT COUNT(*) AS total FROM gallery_images",
    ).first();
    const rows = await env.GALLERY_DB.prepare(
      "SELECT imgur_id, filename, link, mime_type, size, uploaded_at, storage FROM gallery_images ORDER BY uploaded_at DESC, imgur_id DESC LIMIT ? OFFSET ?",
    )
      .bind(limit, offset)
      .all();

    const images = rows.results || [];
    const total = Number(count?.total || 0);
    return jsonResponse({
      images,
      total,
      nextOffset: offset + images.length < total ? offset + images.length : null,
    });
  } catch (error) {
    console.error("Gallery list failed", error);
    return jsonResponse({ error: "读取图库失败，请稍后重试" }, 500);
  }
};

const importGallery = async (request, env) => {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const unavailable = galleryUnavailable(env);
  if (unavailable) return unavailable;
  const auth = await authenticateOwner(request, env);
  if (!auth.ok) return auth.response;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "导入数据格式不正确" }, 400);
  }

  if (!Array.isArray(payload?.images)) {
    return jsonResponse({ error: "缺少图片记录" }, 400);
  }

  const rows = payload.images.slice(0, 1000).map(normalizeImage).filter(Boolean);
  let imported = 0;

  try {
    for (let offset = 0; offset < rows.length; offset += 100) {
      const statements = rows.slice(offset, offset + 100).map((image) =>
        env.GALLERY_DB.prepare(
          "INSERT OR IGNORE INTO gallery_images (imgur_id, filename, link, mime_type, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(
          image.imgur_id,
          image.filename,
          image.link,
          image.mime_type,
          image.size,
          image.uploaded_at,
        ),
      );
      const results = await env.GALLERY_DB.batch(statements);
      imported += results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
    }

    return jsonResponse({ imported, received: payload.images.length });
  } catch (error) {
    console.error("Gallery import failed", error);
    return jsonResponse({ error: "导入本机历史记录失败" }, 500);
  }
};

const deleteGalleryImage = async (request, env) => {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const unavailable = galleryUnavailable(env);
  if (unavailable) return unavailable;
  const auth = await authenticateOwner(request, env);
  if (!auth.ok) return auth.response;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "删除请求格式不正确" }, 400);
  }

  const imageId = String(payload?.image_id || "").trim();
  if (!/^[A-Za-z0-9]{1,64}$/.test(imageId)) {
    return jsonResponse({ error: "图片编号不正确" }, 400);
  }

  try {
    const image = await env.GALLERY_DB.prepare(
      "SELECT storage FROM gallery_images WHERE imgur_id = ?",
    )
      .bind(imageId)
      .first();
    if (!image) return jsonResponse({ error: "图片记录不存在" }, 404);

    if (image.storage === "r2") {
      if (!/^[a-f0-9]{32}$/.test(imageId)) {
        return jsonResponse({ error: "R2 图片编号不正确" }, 400);
      }
      await env.IMAGE_BUCKET.delete(imageId);
    } else if (image.storage === "imgur") {
      const deleteHash = String(payload?.delete_hash || "").trim();
      if (!/^[A-Za-z0-9_-]{20,128}$/.test(deleteHash)) {
        return jsonResponse({ error: "当前浏览器没有这张 Imgur 图片的删除凭据" }, 422);
      }

      const imgurResponse = await fetch(
        "https://api.imgur.com/3/image/" + encodeURIComponent(deleteHash),
        {
          method: "DELETE",
          headers: { Authorization: "Client-ID 546c25a59c58ad7" },
        },
      );
      const result = await imgurResponse.json().catch(() => ({}));
      if (!imgurResponse.ok || result?.success !== true) {
        return jsonResponse({ error: "Imgur 未确认删除，请检查本机保存的删除凭据" }, 502);
      }
    } else {
      return jsonResponse({ error: "不支持删除此存储类型的图片" }, 409);
    }

    await env.GALLERY_DB.prepare(
      "DELETE FROM gallery_images WHERE imgur_id = ?",
    )
      .bind(imageId)
      .run();
    return jsonResponse({ deleted: true, storage: image.storage });
  } catch (error) {
    console.error("Gallery image delete failed", error);
    return jsonResponse({ error: "删除失败，请稍后重试" }, 500);
  }
};

const uploadToR2 = async (request, env) => {
  const unavailable = galleryUnavailable(env);
  if (unavailable) return unavailable;
  const auth = await authenticateOwner(request, env);
  if (!auth.ok) return auth.response;

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ success: false, error: "上传数据格式不正确" }, 400);
  }

  const file = formData.get("file");
  if (!file || typeof file === "string" || !file.type?.startsWith("image/")) {
    return jsonResponse({ success: false, error: "请选择有效图片" }, 400);
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_SIZE) {
    return jsonResponse({ success: false, error: "图片大小不能超过 15 MB" }, 413);
  }

  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const filename = String(file.name || id)
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, 255) || id;
  const uploadedAt = new Date();
  const link = new URL("/v2/" + id, request.url).toString();

  try {
    await env.IMAGE_BUCKET.put(id, file, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=300",
      },
      customMetadata: { filename },
    });
  } catch (error) {
    console.error("R2 image upload failed", error);
    return jsonResponse({ success: false, error: "图片保存失败，请稍后重试" }, 502);
  }

  if (env.GALLERY_DB) {
    try {
      await env.GALLERY_DB.prepare(
        "INSERT OR IGNORE INTO gallery_images (imgur_id, filename, link, mime_type, size, uploaded_at, storage) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(id, filename, link, file.type, file.size, uploadedAt.toISOString(), "r2")
        .run();
    } catch (error) {
      console.error("Saving R2 image metadata to gallery failed", error);
    }
  }

  return jsonResponse({
    success: true,
    status: 200,
    data: {
      id,
      link,
      type: file.type,
      size: file.size,
      datetime: Math.floor(uploadedAt.getTime() / 1000),
    },
  });
};

const getImage = async (request, env, pathname) => {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const key = pathname.slice("/v2/".length);

  if (env.IMAGE_BUCKET && /^[A-Za-z0-9._-]{1,128}$/.test(key)) {
    try {
      const object = await env.IMAGE_BUCKET.get(key);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("ETag", object.httpEtag);
        headers.set("Cache-Control", "public, max-age=300");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(object.body, { headers });
      }
    } catch (error) {
      console.error("R2 image read failed", error);
      return jsonResponse({ error: "读取图片失败" }, 502);
    }
  }

  if (/^[a-f0-9]{32}$/.test(key)) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Old non-R2 image links still resolve through the original Imgur proxy.
  return proxyCachedImage({ request });
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/upload") {
      return request.method === "POST"
        ? uploadToR2(request, env)
        : methodNotAllowed("POST");
    }

    if (pathname === "/api/auth/config") {
      return getAuthConfig(request, env);
    }

    if (pathname === "/api/auth/signup") {
      return signUpOwner(request, env);
    }

    if (pathname === "/api/auth/me") {
      return getCurrentOwner(request, env);
    }

    if (pathname === "/api/gallery") {
      return listGallery(request, env);
    }

    if (pathname === "/api/gallery/import") {
      return importGallery(request, env);
    }

    if (pathname === "/api/gallery/delete") {
      return deleteGalleryImage(request, env);
    }

    if (pathname.startsWith("/v2/")) {
      return getImage(request, env, pathname);
    }

    if (pathname.startsWith("/vh-img-proxy/")) {
      return request.method === "GET"
        ? proxyImgurImage({ request })
        : methodNotAllowed("GET");
    }

    return env.ASSETS.fetch(request);
  },
};
