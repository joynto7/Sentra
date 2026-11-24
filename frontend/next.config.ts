import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The round "N" badge that `next dev` draws in the corner. It exists only in development; the
  // production build never shows it. Switched off so a demo on the dev server looks the same.
  devIndicators: false,
};

export default nextConfig;
