# 0008：资源本地打包，不依赖 CDN

- 状态：采用

## 背景

部分访客的网络访问 Google Fonts 和公共 CDN 不稳定（截图验证时出现过一次 `ERR_CONNECTION_CLOSED`）。

## 决定

- 用 `@fontsource-variable/inter` 打包 Inter 字体，中文回退到 PingFang SC 等系统字体。
- 不引入任何 CDN 脚本和样式。纹理全部由 Canvas 程序化生成（公路、焦痕、价格刻度文字）。

## 后果

- 离线也能完整显示（模拟模式完全不需要外网）。
- 打包体积多了几十 KB 的字体子集。

## 何时重新评估

引入大体积美术资源（glTF、纹理）时，再考虑走 CDN 或懒加载，并且要有国内能访问的镜像。
