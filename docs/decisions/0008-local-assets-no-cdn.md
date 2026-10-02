# 0008：资源本地打包，不依赖 CDN

- 状态：采用

## 背景

部分访客的网络访问 Google Fonts 和公共 CDN 不稳定（截图验证时出现过一次 `ERR_CONNECTION_CLOSED`）。

## 决定

- 用 `@fontsource-variable/inter` 打包 Inter 字体，中文回退到 PingFang SC 等系统字体。
- 不引入任何 CDN 脚本和样式。纹理全部由 Canvas 程序化生成（公路、焦痕、价格刻度文字）。

## 例外（2026-10-03）

访问统计用 Cloudflare Web Analytics 的 beacon（`src/analytics.ts`），这是站点唯一从第三方域名加载的脚本：本地主机（localhost、127.0.0.1、局域网地址、`.local` 等）一律不加载，所以本地开发、预览和验证脚本不会上报；生产域名定下来后改成只认该域名（`ANALYTICS.host`）。加载失败不影响页面，页面功能不依赖它。

## 后果

- 离线也能完整显示（模拟模式完全不需要外网）。
- 打包体积多了几十 KB 的字体子集。

## 何时重新评估

引入大体积美术资源（glTF、纹理）时，再考虑走 CDN 或懒加载，并且要有国内能访问的镜像。
