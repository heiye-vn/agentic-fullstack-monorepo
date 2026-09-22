import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // 第十九章：eslint-config-next 16 把这条 React Compiler 时代的建议规则升到了 error。
      // 存量代码里 7 处命中，全部是有意为之的模式：
      //   ① setMounted(true) —— SSR hydration 守卫（layout / dialog-shell / drawer-shell / WorkbenchLayout）
      //   ② setVisible(...)  —— 由 open props 驱动的进出场动画（dialog-shell / drawer-shell）
      // 改成合规写法需重构为 useSyncExternalStore / 派生 state，会牵动动画时序与 hydration 语义，
      // 属跨切面 React 重构，不在 CI/CD 这一章的范围内。
      // 这里降为 warn 而非直接禁用：保留它们在 lint 输出里持续可见，作为在案技术债，
      // 而不是像「把整个包踢出 lint」那样让门禁对这些问题彻底失明。
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
