import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["src-tauri", "dist"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
