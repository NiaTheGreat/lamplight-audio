import type { NextConfig } from "next";

const config: NextConfig = {
  // A self-contained server for the Docker image and the npm package.
  output: "standalone",
};

export default config;
