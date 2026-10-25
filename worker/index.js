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

const isAdmin = async (request, env) => {
  const expectedHash = String(env.GALLERY_TOKEN_HASH || "").toLowerCase();
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]{8,200})$/.exec(authorization);

  if (!/^[a-f0-9]{64}$/.test(expectedHash) || !match) return false;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(match[1]),
  );
  const actualHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  let mismatch = 0;
  for (let index = 0; index < 64; index += 1) {
    mismatch |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return mismatch === 0;
};

const galleryUnavailable = (env) =>
  !env.GALLERY_DB || !env.GALLERY_TOKEN_HASH
    ? jsonResponse({ error: "图库管理暂不可用" }, 503)
    : null;

const listGallery = async (request, env) => {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const unavailable = galleryUnavailable(env);
  if (unavailable) return unavailable;
  if (!(await isAdmin(request, env))) return jsonResponse({ error: "管理员口令不正确" }, 401);

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
      "SELECT imgur_id, filename, link, mime_type, size, uploaded_at FROM gallery_images ORDER BY uploaded_at DESC, imgur_id DESC LIMIT ? OFFSET ?",
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
  if (!(await isAdmin(request, env))) return jsonResponse({ error: "管理员口令不正确" }, 401);

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

const uploadToR2 = async (request, env) => {
  if (!env.IMAGE_BUCKET) return jsonResponse({ success: false, error: "图片存储暂不可用" }, 503);

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
        cacheControl: "public, max-age=31536000, immutable",
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
        "INSERT OR IGNORE INTO gallery_images (imgur_id, filename, link, mime_type, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(id, filename, link, file.type, file.size, uploadedAt.toISOString())
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
        headers.set("Cache-Control", object.httpMetadata?.cacheControl || "public, max-age=3600");
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

  // Old image links still resolve through the original Imgur proxy.
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

    if (pathname === "/api/gallery") {
      return listGallery(request, env);
    }

    if (pathname === "/api/gallery/import") {
      return importGallery(request, env);
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
