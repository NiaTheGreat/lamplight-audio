import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/", ".cache/", ".e2e-cache/", ".e2e-results/", "playwright-report/", "node_modules/", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
export default config;
