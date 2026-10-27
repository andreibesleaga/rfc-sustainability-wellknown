/** The complexity bound the README states: cyclomatic complexity of 15 or less per function (`&&`, `||` and `??` counted). `npm run lint`. */
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["lib/**/*.mjs", "vectors/**/*.mjs", "sfc-check.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: { complexity: ["error", 15] },
  },
]);
