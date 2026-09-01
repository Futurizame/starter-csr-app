import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["build/", ".react-router/", "infra/cdk.out/", "node_modules/"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The migration boundary. Only route modules may know which router we use;
    // everything below them is plain React and plain TypeScript, so moving to
    // another framework means rewriting app/routes/ and nothing else.
    files: ["app/features/**/*.{ts,tsx}", "app/components/**/*.{ts,tsx}", "app/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-router",
              message:
                "Router imports belong in app/routes/. Pass data and callbacks down as props instead.",
            },
          ],
          patterns: [
            {
              group: ["@react-router/*"],
              message: "Router imports belong in app/routes/.",
            },
          ],
        },
      ],
    },
  },
  {
    // lib/config.ts is the single place allowed to read the environment, so a
    // move to another framework is a one-file change instead of a grep.
    files: ["app/**/*.{ts,tsx}"],
    ignores: ["app/lib/config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.type='MetaProperty']",
          message: "Read environment values from app/lib/config.ts instead of import.meta.env.",
        },
      ],
    },
  },
  prettier,
);
