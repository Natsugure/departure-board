import globals from "globals"
import { defineConfig, globalIgnores } from "eslint/config"
import baseConfig from "../../eslint.config.base.js"

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.ts"],
    extends: [...baseConfig],
    languageOptions: {
      globals: globals.node,
    },
  },
])
