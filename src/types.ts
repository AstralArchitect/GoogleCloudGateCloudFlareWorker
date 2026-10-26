export interface Env {
  /**
   * Google Maps Platform API key stored as a secret in Cloudflare.
   * Required for querying Google Cloud APIs.
   */
  GOOGLE_MAPS_API_KEY: string;

  /**
   * Optional shared secret to protect the worker from public abuse.
   * If defined, clients must send header `X-App-Token` or `Authorization: Bearer <APP_TOKEN>`.
   */
  APP_TOKEN?: string;

  /**
   * Toggle Cloudflare Edge caching ("true" or "false"). Default: "true".
   */
  ENABLE_CACHE?: string;

  /**
   * Cache duration for reverse geocoding in seconds. Default: 604800 (7 days).
   */
  GEOCODING_CACHE_TTL?: string;

  /**
   * Cache duration for Pollen forecast in seconds. Default: 3600 (1 hour).
   */
  POLLEN_CACHE_TTL?: string;

  /**
   * Cache duration for Air Quality in seconds. Default: 1800 (30 minutes).
   */
  AIR_QUALITY_CACHE_TTL?: string;
}

export type RouteTarget = {
  upstreamHost: string;
  upstreamPath: string;
  allowedMethods: string[];
  cacheTtlSeconds: number;
};

