import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["terminal.local"],
  compress: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react", "lucide-react", "radix-ui"],
  },
};

export default nextConfig;
