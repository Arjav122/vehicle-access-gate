// ESLint flat config: type-aware rules from typescript-eslint (strict preset).
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist", "coverage"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  // This config file itself is plain JS, outside the TS project.
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
);
