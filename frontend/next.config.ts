import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output creates a self-contained build for the distributable package.
  // The .next/standalone directory includes a minimal Node.js server and only
  // the dependencies needed to run - no full node_modules required.
  output: "standalone",
  // The Agent SDK must run from real node_modules, not a webpack bundle (#92):
  // bundled, it spawns and connects fine but its in-process MCP tool schemas
  // never reach the model (verified: identical options work in a plain node
  // script and fail inside the route until this line).
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "zod"],
  // Allow local-network IPs so the app works when accessed from a phone on the same
  // WiFi. The PC's DHCP lease drifts (.41 -> .47 seen so far), so cover the subnet's
  // observed addresses rather than one pinned IP.
  allowedDevOrigins: ["192.168.1.41", "192.168.1.47"],
};

export default nextConfig;
