import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Autix RBAC - 现代化权限管理控制中心",
  description: "基于 NestJS + Next.js 16 + HeroUI 构建的企业级 RBAC 权限管理平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <body
        suppressHydrationWarning
        className={`${inter.className} min-h-screen bg-slate-50 text-slate-900 antialiased selection:bg-blue-600 selection:text-white`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

