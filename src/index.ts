import { Env, RouteTarget } from "./types";

/**
 * Resolves incoming request path & method to the corresponding Google API target.
 */
function resolveRoute(pathname: string, method: string, env: Env): RouteTarget | null {
  const normPath = pathname.replace(/\/+$/, "");

  // Air Quality endpoints
  if (
    normPath === "/airquality/v1/currentConditions:lookup" ||
    (normPath === "/v1/currentConditions:lookup" && method === "POST")
  ) {
    return {
      upstreamHost: "airquality.googleapis.com",
      upstreamPath: "/v1/currentConditions:lookup",
      allowedMethods: ["POST"],
      cacheTtlSeconds: parseInt(env.AIR_QUALITY_CACHE_TTL || "1800", 10),
    };
  }

  if (
    normPath === "/airquality/v1/forecast:lookup" ||
    (normPath === "/v1/forecast:lookup" && method === "POST")
  ) {
    return {
      upstreamHost: "airquality.googleapis.com",
      upstreamPath: "/v1/forecast:lookup",
      allowedMethods: ["POST"],
      cacheTtlSeconds: parseInt(env.AIR_QUALITY_CACHE_TTL || "1800", 10),
    };
  }

  // Pollen endpoints
  if (
    normPath === "/pollen/v1/forecast:lookup" ||
    (normPath === "/v1/forecast:lookup" && method === "GET")
  ) {
    return {
      upstreamHost: "pollen.googleapis.com",
      upstreamPath: "/v1/forecast:lookup",
      allowedMethods: ["GET"],
      cacheTtlSeconds: parseInt(env.POLLEN_CACHE_TTL || "3600", 10),
    };
  }

  // Geocoding endpoints
  if (
    normPath === "/maps/api/geocode/json" ||
    normPath === "/geocode" ||
    normPath === "/geocode/json"
  ) {
    return {
      upstreamHost: "maps.googleapis.com",
      upstreamPath: "/maps/api/geocode/json",
      allowedMethods: ["GET"],
      cacheTtlSeconds: parseInt(env.GEOCODING_CACHE_TTL || "604800", 10), // 7 days
    };
  }

  return null;
}

/**
 * Computes a SHA-256 hash of a string, returned as a hex string.
 */
async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Health check & status endpoint
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          name: "TheMeteo Google Maps Platform Gateway",
          status: "healthy",
          timestamp: new Date().toISOString(),
          hasGoogleKey: Boolean(env.GOOGLE_MAPS_API_KEY && env.GOOGLE_MAPS_API_KEY.length > 5),
          hasAppTokenProtection: Boolean(env.APP_TOKEN),
          cachingEnabled: env.ENABLE_CACHE !== "false",
          supportedRoutes: [
            "POST /airquality/v1/currentConditions:lookup",
            "POST /airquality/v1/forecast:lookup",
            "GET  /pollen/v1/forecast:lookup",
            "GET  /maps/api/geocode/json",
          ],
        }, null, 2),
        {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }
      );
    }

    // 2. Security: Verify App Token if APP_TOKEN is configured in env
    if (env.APP_TOKEN && env.APP_TOKEN.trim().length > 0) {
      const authHeader = request.headers.get("Authorization");
      const appTokenHeader = request.headers.get("X-App-Token");
      const tokenFromAuth = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
      const clientToken = appTokenHeader?.trim() || tokenFromAuth;

      if (!clientToken || clientToken !== env.APP_TOKEN.trim()) {
        return new Response(
          JSON.stringify({
            error: "Unauthorized",
            message: "Missing or invalid app token (X-App-Token or Authorization: Bearer).",
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          }
        );
      }
    }

    // 3. Resolve Target Route
    const route = resolveRoute(url.pathname, request.method, env);
    if (!route) {
      return new Response(
        JSON.stringify({
          error: "Not Found",
          message: `The requested path '${url.pathname}' is not supported by this gateway.`,
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }
      );
    }

    if (!route.allowedMethods.includes(request.method)) {
      return new Response(
        JSON.stringify({
          error: "Method Not Allowed",
          message: `Method ${request.method} is not supported for ${url.pathname}. Supported methods: ${route.allowedMethods.join(", ")}`,
        }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            Allow: route.allowedMethods.join(", "),
          },
        }
      );
    }

    // 4. Validate Google API Key configuration
    if (!env.GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error: "Server Configuration Error",
          message: "GOOGLE_MAPS_API_KEY is not configured on this Cloudflare Worker. Please run 'wrangler secret put GOOGLE_MAPS_API_KEY'.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }
      );
    }

    // 5. Construct Google Upstream URL
    const upstreamUrl = new URL(`https://${route.upstreamHost}${route.upstreamPath}`);

    // Forward original query parameters, removing any client-supplied 'key'
    for (const [key, value] of url.searchParams.entries()) {
      if (key.toLowerCase() !== "key") {
        upstreamUrl.searchParams.append(key, value);
      }
    }

    // Inject the secret Google Maps API key
    upstreamUrl.searchParams.set("key", env.GOOGLE_MAPS_API_KEY.trim());

    // 6. Handle Caching
    const isCachingEnabled = env.ENABLE_CACHE !== "false";
    const cache = caches.default;

    let bodyText: string | null = null;
    let cacheKeyUrl: string | null = null;

    if (isCachingEnabled) {
      // Build a deterministic cache key URL (without the secret API key)
      const sanitizedUrl = new URL(request.url);
      sanitizedUrl.searchParams.delete("key");
      // Sort query params for consistent cache keys
      sanitizedUrl.searchParams.sort();

      if (request.method === "GET") {
        cacheKeyUrl = sanitizedUrl.toString();
      } else if (request.method === "POST") {
        // Read body text once so we can both hash it for cache key and send it upstream
        bodyText = await request.text();
        const bodyHash = await sha256(bodyText);
        sanitizedUrl.searchParams.set("__body_hash", bodyHash);
        cacheKeyUrl = sanitizedUrl.toString();
      }

      if (cacheKeyUrl) {
        // Create synthetic GET request for cache lookup
        const cacheKeyRequest = new Request(cacheKeyUrl, { method: "GET" });
        const cachedResponse = await cache.match(cacheKeyRequest);
        if (cachedResponse) {
          const newHeaders = new Headers(cachedResponse.headers);
          newHeaders.set("X-Gateway-Cache", "HIT");
          return new Response(cachedResponse.body, {
            status: cachedResponse.status,
            statusText: cachedResponse.statusText,
            headers: newHeaders,
          });
        }
      }
    }

    // 7. Prepare Headers for Google Upstream
    const upstreamHeaders = new Headers();

    const contentType = request.headers.get("content-type");
    if (contentType) {
      upstreamHeaders.set("Content-Type", contentType);
    } else if (request.method === "POST") {
      upstreamHeaders.set("Content-Type", "application/json");
    }

    const accept = request.headers.get("accept");
    if (accept) {
      upstreamHeaders.set("Accept", accept);
    } else {
      upstreamHeaders.set("Accept", "application/json");
    }

    // 8. Fetch from Google Upstream
    try {
      const upstreamRequest = new Request(upstreamUrl.toString(), {
        method: request.method,
        headers: upstreamHeaders,
        body: request.method === "POST" ? (bodyText ?? (await request.text())) : null,
      });

      const response = await fetch(upstreamRequest);

      // Clone response to inspect/cache if needed
      const responseBody = await response.text();

      // Setup response headers
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("X-Gateway-Cache", "MISS");
      responseHeaders.set("Access-Control-Allow-Origin", "*");

      // Remove upstream headers that shouldn't leak or conflict
      responseHeaders.delete("server");
      responseHeaders.delete("x-frame-options");

      // Cache successful responses (200 OK)
      if (isCachingEnabled && response.status === 200 && cacheKeyUrl && route.cacheTtlSeconds > 0) {
        responseHeaders.set("Cache-Control", `public, max-age=${route.cacheTtlSeconds}, s-maxage=${route.cacheTtlSeconds}`);

        const responseToCache = new Response(responseBody, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });

        const cacheKeyRequest = new Request(cacheKeyUrl, { method: "GET" });
        ctx.waitUntil(cache.put(cacheKeyRequest, responseToCache.clone()));
      }

      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({
          error: "Bad Gateway",
          message: "Failed to communicate with Google API upstream.",
          detail: errorMessage,
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }
      );
    }
  },
};

