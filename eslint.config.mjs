import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // three.js objects created once per component are mutated inside the R3F render loop (useFrame) on
    // purpose: per-frame values must never go through React state. The compiler's immutability rule
    // cannot distinguish that from mutating React state, so it is disabled for the scene layer only.
    files: ["src/scene/**/*.tsx", "src/brain/BrainCanvas.tsx"],
    rules: { "react-hooks/immutability": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // Python CT pipeline: its virtualenv ships third-party JS
    "pipeline/**",
    "data/**",
  ]),
]);

export default eslintConfig;
