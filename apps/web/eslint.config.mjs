import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Service-role fence (ADR 0025): the RLS-bypassing admin client is only
  // touchable from the token-custodian modules. Every new consumer is a
  // security-review event, not a convenience import. Three layers, each
  // probe-tested: static imports (any spelling incl. sibling ./admin),
  // dynamic import(), and reaching for the raw env key without the module.
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    ignores: ["lib/integrations/**", "lib/supabase/admin.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/supabase/admin",
                "**/supabase/admin",
                "**/supabase/admin.ts",
                "./admin",
                "./admin.ts",
              ],
              message:
                "Service-role client bypasses RLS — only lib/integrations/* may import it (ADR 0025).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: 'ImportExpression Literal[value=/supabase\\u002fadmin/]',
          message:
            "Dynamic import of the service-role client is fenced too — only lib/integrations/* (ADR 0025).",
        },
        {
          selector: 'MemberExpression[property.name="SUPABASE_SERVICE_ROLE_KEY"]',
          message:
            "The service-role key is only readable inside lib/supabase/admin.ts — use createAdminClient via lib/integrations/* (ADR 0025).",
        },
        {
          selector: 'MemberExpression[property.value="SUPABASE_SERVICE_ROLE_KEY"]',
          message:
            "The service-role key is only readable inside lib/supabase/admin.ts — use createAdminClient via lib/integrations/* (ADR 0025).",
        },
        {
          selector:
            'ObjectPattern > Property[key.name="SUPABASE_SERVICE_ROLE_KEY"]',
          message:
            "Destructuring the service-role key is fenced — use createAdminClient via lib/integrations/* (ADR 0025).",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
