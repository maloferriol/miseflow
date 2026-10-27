// One config for the three workspaces (README "CI and the quality gate"). Type-aware rules run on
// every file a workspace tsconfig includes; files outside them get the rules that need no types.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".claude/",
      "**/dist/",
      "**/coverage/",
      "supabase/",
      "playwright-report/",
      "test-results/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: {
          // web's Vite and Vitest configs sit outside web/tsconfig.json.
          allowDefaultProject: ["web/*.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // `const { id: _, ...rest } = row` drops a key on purpose.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
      // No form here has a file input, so a FormData value is always a string. The option
      // replaces the rule's default list, so the defaults are repeated before "File".
      "@typescript-eslint/no-base-to-string": [
        "error",
        { ignoredTypeNames: ["Error", "RegExp", "URL", "URLSearchParams", "File"] },
      ],
    },
  },
  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: ["web/src/**"],
    languageOptions: { globals: globals.browser },
  },
  {
    // Tests read response bodies as `any` (`await res.json()`) and assert on them.
    files: ["**/test/**", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    // No tsconfig includes these, so they get no type information.
    files: ["*.{js,ts}", "scripts/**", "e2e/**"],
    ...tseslint.configs.disableTypeChecked,
  },
  // Last, so formatting stays Prettier's job.
  prettier,
);
