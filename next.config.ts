import type { NextConfig } from "next";

const configuredApiOrigin = process.env.VENUEMIND_API_ORIGIN ?? "https://venue-mind-api.seyamalam41.workers.dev";
const apiUrl = new URL(configuredApiOrigin);
if (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password || apiUrl.pathname !== "/")
  throw new TypeError("VENUEMIND_API_ORIGIN must be one credential-free HTTPS origin");
const apiOrigin = apiUrl.origin;

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" },
] as const;

const publicContractCache = [
  { key: "Cache-Control", value: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" },
] as const;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["terminal.local"],
  cacheComponents: true,
  compress: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react", "lucide-react", "radix-ui"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: [...securityHeaders] },
      { source: "/llms.txt", headers: [...publicContractCache] },
      { source: "/llms-full.txt", headers: [...publicContractCache] },
      { source: "/schemas/:path*", headers: [...publicContractCache] },
      { source: "/guides/:path*", headers: [...publicContractCache] },
      { source: "/venue-tools.json", headers: [...publicContractCache] },
      { source: "/authorization-policy.json", headers: [...publicContractCache] },
      { source: "/error-catalog.json", headers: [...publicContractCache] },
      { source: "/docs-manifest.json", headers: [...publicContractCache] },
      { source: "/reference-manifest.json", headers: [...publicContractCache] },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
