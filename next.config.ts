import type { NextConfig } from "next";

const apiOrigin = process.env.VENUEMIND_API_ORIGIN ?? "https://venue-mind-api.seyamalam41.workers.dev";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["terminal.local"],
  cacheComponents: true,
  compress: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react", "lucide-react", "radix-ui"],
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
