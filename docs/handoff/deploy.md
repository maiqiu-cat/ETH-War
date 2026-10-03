# 发布到 ethwar.ondream.ai

> **状态（2026-10-03 UTC）：已首次发布。** 当前版本 `20261003-0014-af0515b`，源码提交 `af0515baf737a358cb922f0bbca45690042f732e`，上一版：无。公网首页 SHA-256 `f0066b7e9c72d49e22bbe8c887a64e1fbcd3bbf0fc5d28940fee885099a69ea1` 与发布包一致；`AUDIT OK`，首次发布重载两次（deploy、cert）。验收详情见 [verification/README.md](../verification/README.md) 和 [session-log.md](session-log.md)。这仍是浏览器直连交易所的原型；正式产品仍需服务端聚合和数据条款审查。

`site.webmanifest` 当前以 `application/octet-stream` 返回，HTTP 200、JSON 有效且与发布包逐字节一致；用户明确接受这一差异继续发布。后续 MIME 修正记在 [backlog](../roadmap/backlog.md)，本次没有修改站点配置。

机制整套来自母项目 Bitcoin War（它的 `deploy/` 在生产上发布过多次），只把站点名换成了 `ethwar`：发布包前缀 `ethwar-`，站点目录 `/var/www/ethwar.ondream.ai/`，Nginx 配置 `zz-ethwar.ondream.ai.conf`，发布根目录默认 `/root/ethwar-deploy/`。两个项目在服务器上互不相干。

## 服务器资料只在本机（`private/`，不入库）

| 文件 | 内容 |
| --- | --- |
| `private/deploy/site.env` | `DEPLOY_HOST`（SSH 别名）、`DEPLOY_ROOT`、`EXPECT_IP`。`push.sh` 和 `package.sh` 读取，模板是 [`deploy/examples/site.env`](../../deploy/examples/site.env) |
| `private/deploy/https-listen.conf` | HTTPS 模板里的 `listen` 行（服务器自己的地址）。`render-nginx.sh` 打包时填进模板，模板是 [`deploy/examples/https-listen.conf`](../../deploy/examples/https-listen.conf) |
| `private/docs/handoff/deploy.md` | 目标环境、SSH 方式、首次发布与母项目的区别、SSH 不通时的备选 |
| `private/docs/handoff/release-*.md` | Codex 发布手册。新发布照着最近一份写，也放在这里 |
| `private/docs/handoff/analytics.md` | 访问统计的仪表盘入口和 token |

服务器 IP、主机名或 SSH 别名、SSH 用户和密钥、内网/VPN 地址、同机其他站点和容器、系统与软件版本、云服务商和 DNS 服务商、本机网络配置，都只写进 `private/`。入库的脚本和文档用 [RFC 5737](https://www.rfc-editor.org/rfc/rfc5737) 文档专用地址（`192.0.2.0/24`、`198.51.100.0/24`、`203.0.113.0/24`）举例。

## 访问统计

线上页面通过 `src/analytics.ts` 加载 Cloudflare Web Analytics 的 beacon，只在 `ethwar.ondream.ai` 域名下加载。以后给 Nginx 加 Content-Security-Policy 时，必须放行 `script-src https://static.cloudflareinsights.com` 和 `connect-src https://cloudflareinsights.com`，否则统计会静默失效。

## 为什么不用容器

ETH War 是**纯静态网站**，服务器上没有常驻进程。容器隔离的是进程，对静态文件几乎没有额外的隔离作用；80/443 端口在宿主机的 Nginx 手里，不管用不用容器都要在宿主机 Nginx 里加一个站点并申请证书，**真正可能影响其他站点的就是这个共用入口**，所以保护其他站点要靠下面「安全设计」里的那套机制。以后加服务端聚合服务（backlog P0）时，那个后端必须放进独立容器：只监听 `127.0.0.1` 的某个端口，限制内存和 CPU，非 root，只读根文件系统。

## 安全设计（`deploy/server/install.sh`）

- **只碰这几处**：
  - `/var/www/ethwar.ondream.ai/`（`releases/<id>`、`current` 软链接、`.state/` 备份）
  - `/var/www/ethwar-acme/`
  - `/etc/nginx/conf.d/zz-ethwar.ondream.ai.conf`
  - certbot 的 `ethwar.ondream.ai` 证书
  - `DEPLOY_ROOT`（默认 `/root/ethwar-deploy/`：发布包和首次发布前的 Nginx 基线）
- **配置文件名用 `zz-` 前缀**，保证它最后加载，不会成为 80/443 的隐式默认站点。
- **HTTPS 只监听服务器上其他站点已经在用的显式套接字**（写在 `private/deploy/https-listen.conf`，打包时由 `deploy/render-nginx.sh` 填进模板）。裸的 `listen 443` 会在任何改动之前被拒绝。
- **改动前记录基线**（`DEPLOY_ROOT/baseline/`）：`/etc/nginx` 打包、`nginx -T` 指纹、每个文件的哈希、站点返回码、默认证书、监听端口、容器列表。基线只记一次，是 `purge` 的还原目标。
- **重载后确认新配置真的生效**（探测文件，以及 HTTPS 出示的证书主题），防止重载失败后 Nginx 默默沿用旧配置。
- **每次改 Nginx 配置的流程**：
  1. 用 `nginx -T` 解析出所有其他站点。
  2. 通过本机回环地址记下它们在 HTTP 和 HTTPS 上的返回码（「改前快照」）。
  3. 备份旧配置，装上新配置，运行 `nginx -t`。
  4. 重载 Nginx，再记一次「改后快照」。
  5. **只要 `nginx -t` 失败，或者任何其他站点的返回码有变化，就自动恢复旧配置、重新加载，然后退出。**
- **部署顺序**：先放好新版本的文件，再更新 Nginx 配置（经过上面的验证），然后切换 `current`，最后校验首页 SHA、静态资源的缓存头和一个音频文件。校验失败就自动切回上一版。
- **内容更新不重载 Nginx**：站点配置与渲染后的模板逐字节相同且探测证明配置正在生效时，脚本只切换 `current`，不重载共用 Nginx。**首次发布是例外**：新站点必然安装配置并重载一次（HTTP 阶段），`cert` 切 HTTPS 时再重载一次，之后的内容发布不再重载。
- **只读审计**：`deploy/push.sh <发布包> audit` 比对首次发布前的 Nginx 文件、其他站点 HTTP/HTTPS 返回码、默认证书、监听端口及容器状态；预期是 `AUDIT OK`，差异只有本站点。
- **不覆盖已有版本**：同一个版本号不能重复部署。
- **申请证书前的检查**：先确认服务器上解析 `ethwar.ondream.ai` 得到的就是 `EXPECT_IP`（`package.sh` 从 `private/deploy/site.env` 写进发布包的 `site.env`），再通过 Nginx 自测 ACME 验证路径能访问，最后才调用 certbot。
- **证书续期**：复用服务器上已有的 certbot 续期定时器，以及全局 deploy hook（续期后重载 Nginx），不新增定时任务。

### 本机演练（Docker，Ubuntu 24.04 + nginx）

`deploy/test/rehearse.sh` 用 `deploy/examples/https-listen.conf` 里的文档专用地址渲染模板，不依赖 `private/`。依次覆盖：

1. 预检能识别其他站点（包括写成一行的 `server {}`）
2. 部署（记录基线、安装配置、切换 `current`、校验）
3. 拒绝重复部署同一版本
4. 部署第二个版本（配置不变 → 不重载），再回滚
5. **坏配置**：自动恢复旧配置，线上版本不变，坏版本不会被访问到
6. **裸 `listen 443` 模板**：在任何改动之前被拒绝
7. 申请证书（假 CA）并切到 HTTPS，其他站点和默认证书不变
8. HTTPS 下的纯内容发布：不重载，`audit OK`；回滚到逐字节相同的上一版
9. `purge` 后 Nginx 配置指纹与发布前一致，其他站点及默认证书不变

每一步都会检查其他站点是否正常。最后一行必须是 `REHEARSAL PASSED`。

## 发布步骤（获得授权后执行）

每次发布前先写一份执行手册（`private/docs/handoff/release-*.md`），通用流程见 [release-and-publish.md](release-and-publish.md)。首次发布的命令：

```bash
cd "<项目目录>"
deploy/package.sh                                        # 构建 + 生成发布包（工作区必须干净）
deploy/test/rehearse.sh                                  # 本机演练（首次发布必须做）
deploy/push.sh deploy/out/ethwar-<id>.tar.gz preflight   # 上传并做只读预检，把结果给用户看
deploy/push.sh deploy/out/ethwar-<id>.tar.gz deploy      # 部署（HTTP）：安装 Nginx 站点并重载一次
deploy/push.sh deploy/out/ethwar-<id>.tar.gz cert        # 申请证书并切到 HTTPS：再重载一次
deploy/push.sh deploy/out/ethwar-<id>.tar.gz audit       # 与基线比对
deploy/push.sh deploy/out/ethwar-<id>.tar.gz status
```

核对 DNS 是否生效（本机解析结果可能不准确，用 DoH）：

```bash
curl -s "https://1.1.1.1/dns-query?name=ethwar.ondream.ai&type=A" -H 'accept: application/dns-json'
```

以后的内容发布只需 `package.sh` → 演练 → `preflight` → `audit` → `deploy` → `audit`，配置不变时不需要 `cert`，Nginx 不重载。SSH 不通时的备选办法见 `private/docs/handoff/deploy.md`。

## 回滚与下线

| 目的 | 命令（在服务器上，在任意一个已解压的发布包目录里执行） |
| --- | --- |
| 回到上一版（第二次及以后发布） | `bash $DEPLOY_ROOT/ethwar-<id>/install.sh rollback`，自动校验首页与静态资源 |
| 完全回退到基线（带验证） | `bash ethwar-<id>/install.sh purge`：删除配置、验证 `nginx -T` 指纹与基线一致、比对每个站点、删除文件和证书（`KEEP_CERT=1` 时保留证书）。首次发布没有上一版，回退就是它 |
| 应急（脚本不可用时） | `rm /etc/nginx/conf.d/zz-ethwar.ondream.ai.conf && nginx -t && systemctl reload nginx` |
| DNS | 在 DNS 服务商删除 `ethwar` 这条 A 记录 |
