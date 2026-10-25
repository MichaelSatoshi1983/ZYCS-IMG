import { onRequest as uploadImage } from "../functions/upload.js";
import { onRequestGet as proxyCachedImage } from "../functions/v2/[vkey].js";
import { onRequestGet as proxyImgurImage } from "../functions/vh-img-proxy/[vkey].js";

const methodNotAllowed = () =>
  new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, POST" },
  });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/upload") {
      return request.method === "POST"
        ? uploadImage({ request })
        : methodNotAllowed();
    }

    if (pathname.startsWith("/v2/")) {
      return request.method === "GET"
        ? proxyCachedImage({ request })
        : methodNotAllowed();
    }

    if (pathname.startsWith("/vh-img-proxy/")) {
      return request.method === "GET"
        ? proxyImgurImage({ request })
        : methodNotAllowed();
    }

    return env.ASSETS.fetch(request);
  },
};
