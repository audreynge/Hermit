import type { NextConfig } from "next";

const config: NextConfig = {
  // The report page reads site files (public OSM/Census data, with foot-traffic heat) on the server.
  outputFileTracingIncludes: { "/api/**": ["./data/**/*"], "/shell/**": ["./data/sample/site/**/*"] },
};
export default config;
