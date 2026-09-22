import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// 第十九章：Next 16 移除了 `next lint`，改为直接跑 ESLint flat config。
// 原先 package.json 里的 "lint": "next lint" 在 Next 16 下已失效（命令不存在），
// 本文件 + "lint": "eslint" 让 admin-web 重新纳入 turbo lint 门禁。
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // 第十九章：同 chat-web。存量 7 处命中，全部是「挂载后拉列表再 setState」的
      // 数据加载模式（departments / logs / permission-center / profile / roles / users）。
      // 合规写法需要引入 SWR / React Query 或迁到 use() + Suspense，属架构级改动，
      // 超出本章范围。降为 warn 让债务持续可见，而不是让包整体脱离 lint 门禁。
      "react-hooks/set-state-in-effect": "warn",
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
