# Codex 操作手册：生产发布与 GitHub 公开仓库推送

> **仓库 <https://github.com/maiqiu-cat/ETH-War> 是公开的。** 推上去的每一样东西，包括文件、提交信息、作者邮箱和图片里的元数据，任何人都能看到，而且删不干净。
>
> 本手册只写通用流程。服务器参数、服务器相关的排障和每次发布的具体手册只在本机 `private/`，不入库。机制说明见 [deploy.md](deploy.md)。

## 0. 授权与红线

- **「生产发布」和「推送 GitHub」是两件事，要用户在当次会话里分别明确授权。** 只授权了一件，就只做一件。连生产服务器做只读检查之前也先问一声。
- 只推 `main`，只做快进推送：不 force push，不删分支，不推其他分支或 tag。`scripts/git-hooks/pre-push` 会拒绝其他 ref。
- **下面这些内容不能进入仓库**（文件、提交信息、发布记录都算），只写进 `private/`：
  - 服务器的 IP、主机名、SSH 别名、SSH 用户、密钥文件名
  - 内网和 VPN 地址、监听套接字
  - 同一台服务器上的其他站点、域名、容器、端口
  - 服务器的系统和软件版本（包括 `Server:` 响应头里的版本号）、云服务商、DNS 服务商
  - 本机的网络配置、本机时区（时间一律写 UTC）、本机绝对路径
  - 个人邮箱（提交身份一律用 GitHub noreply 地址）
  - 第三方画面（例如原版参考帧）
- **服务器命令的原始输出不入库**：`install.sh` 的 `preflight`、`audit`、`status`、`deploy`、`cert` 输出会列出其他站点、监听端口、容器和证书。原始输出只能存到 `deploy/out/`（已忽略）或 `private/`。入库的发布记录只写下面这些摘要：
  - 版本号、源码提交
  - 我们自己 `index.html` 的哈希、发布包哈希
  - `AUDIT OK`、`no reload` 或「首次发布，重载两次」
  - 各项检查的 PASS 数

## 1. 三道防线

| 防线 | 作用 | 位置 |
| --- | --- | --- |
| `.gitignore` | `private/`、`deploy/out/`（发布包里的 `site.env` 含服务器 IP）、`verification/*.png` 都不入库 | 仓库根目录 |
| 钩子 | `pre-commit` 和 `commit-msg`：按敏感清单拦截改动和提交信息，拒绝提交 `private/` 下的文件<br>`pre-push`：只允许推 `main`，并对这次要推的提交运行 `scripts/check-public.sh` | `scripts/git-hooks/`，需要 `git config core.hooksPath scripts/git-hooks` |
| `pnpm check:public` | 逐个检查待推送的提交（改动、提交信息、新增的二进制文件、作者和提交者邮箱、提交时间必须是 UTC），再整体检查 HEAD 的文件树。会拦截以下内容：<br>- 敏感清单里的字符串<br>- `127/8`、`0.0.0.0`、`1.1.1.1` 和 RFC 5737 文档地址以外的 IPv4<br>- noreply 以外的邮箱<br>- 被跟踪的 `private/` 文件<br>找不到清单就直接判失败 | `scripts/check-public.sh`，`bash scripts/check-public.sh --all` 检查全部历史 |

敏感清单在本机 `private/deploy/forbidden-patterns.txt`，每行一个扩展正则，不区分大小写。出现新的敏感字符串时，比如换了服务器或者同机加了站点，**先把它加进清单，再写任何文档**。

**换了新机器或新 clone，先做这几步**：

```bash
git config core.hooksPath scripts/git-hooks
git config user.name CiCi
git config user.email 267608349+maiqiu-cat@users.noreply.github.com
```

然后向用户要 `private/` 目录（服务器参数和敏感清单）。仓库里只有模板 `deploy/examples/`，没有真实值。没有 `private/deploy/forbidden-patterns.txt` 时，`check:public` 会拒绝放行，不要绕过。

## 2. 推送到 GitHub（公开仓库）

```bash
cd "<项目目录>"
git status --short                 # 必须为空，未提交的改动先提交或说明（提交用 TZ=UTC git commit …）
git fetch origin
git status -sb | head -1           # 只能是 ahead N，不能有 behind
pnpm check:public                  # 最后一行必须是 check-public: OK (...)
git push origin main               # pre-push 钩子会再检查一次这次推送的范围
git ls-remote origin refs/heads/main   # 必须等于 git rev-parse HEAD
gh repo view maiqiu-cat/ETH-War --json visibility,defaultBranchRef
```

- **出现 behind**（用户在网页上改过东西）：用 `git pull --rebase origin main` 把本地未推送的提交接到后面，再从 `check:public` 重新开始。
- **`check:public` 失败**：**停下，不要推送。**
  - 问题只在未推送的提交里：把内容移到 `private/`，用 `TZ=UTC git commit --amend` 或重新整理这几个未推送的提交，再从头检查。
  - 问题已经在远端：**立即停下报告用户**。处理方式只有重写历史后强制推送，或者删库重建，必须由用户决定。
- 钩子报错时不要用 `--no-verify` 绕过，有疑问就问用户。

推送后再做一次远端读回检查（可选，但大改动后推荐）：

```bash
P="$PWD/private/deploy/forbidden-patterns.txt"; T=$(mktemp -d)
git clone -q https://github.com/maiqiu-cat/ETH-War.git "$T/ew"
(cd "$T/ew" && PUBLIC_CHECK_PATTERNS="$P" bash scripts/check-public.sh --all)   # check-public: OK
rm -rf "$T"
```

## 3. 生产发布

服务器参数在 `private/deploy/site.env` 和 `private/deploy/https-listen.conf`，`deploy/package.sh` 和 `deploy/push.sh` 会自动读取。需要直接 SSH 时，先载入参数，不要在命令或文档里写出主机：

```bash
( . private/deploy/site.env && ssh -o BatchMode=yes -o ConnectTimeout=12 "$DEPLOY_HOST" 'date -u' )
```

**每次发布先写一份执行手册**：以最近一份 `private/docs/handoff/release-*.md` 为模板，存为 `private/docs/handoff/release-<日期>-<主题>.md`，写清本次内容、预期哈希和停止条件。说明见 `private/docs/handoff/README.md`。下面是通用步骤：

### 3.1 前置检查（本机，只读）

```bash
git status --short                                   # 必须为空
git fetch origin && git status -sb | head -1         # ## main...origin/main，没有 ahead/behind：线上跑的提交在 GitHub 上一定能找到
git log --oneline -3
git diff --stat <上次发布的源码提交> HEAD -- deploy/   # 有改动则 3.3 的 Docker 演练必须做；首次发布必须做
```

- 上次发布的源码提交和版本号见 [deploy.md](deploy.md) 顶部状态。
- SSH 不通：**停下**，排障见 `private/docs/handoff/deploy.md`。不要改本机网络配置。

### 3.2 打包

```bash
deploy/package.sh                    # 需要干净的工作区；从 private/deploy/ 读取服务器参数
ID=<输出里的 id>; K=deploy/out/ethwar-$ID
cat $K/release.json                  # "dirty": false，commit 等于 HEAD
tar -tvzf $K.tar.gz | awk '{print $3":"$4}' | sort | uniq -c   # 只有一行 root:root
diff -r dist $K/site && echo "kit == dist"
shasum -a 256 $K/nginx/ethwar.https.conf
```

从第二次发布起，**渲染出的 HTTPS 配置必须与线上配置逐字节相同**，否则部署会重载共用的 Nginx；线上的值在 3.4 a) 读取，两者不一致就停下问用户。首次发布时线上还没有这个文件，记下渲染哈希，写进本次手册和 `private/docs/handoff/README.md`。

### 3.3 本机验证

```bash
pnpm build && pnpm test
pnpm verify:mobile                   # MOBILE LAYOUT CHECKS PASSED (24)
pnpm verify:audio                    # AUDIO CHECKS PASSED
docker info >/dev/null && deploy/test/rehearse.sh $K    # 最后一行 REHEARSAL PASSED
```

演练需要 Docker Desktop 正在运行，没开就 `open -a Docker`，等它起来再跑。演练用的是 `deploy/examples/` 里的文档地址，不依赖 `private/`。

### 3.4 生产只读检查（需要用户授权）

```bash
# a) 线上配置的哈希（首次发布时文件不存在，这一步跳过）
( . private/deploy/site.env && ssh "$DEPLOY_HOST" 'sha256sum /etc/nginx/conf.d/zz-ethwar.ondream.ai.conf' )
# b) 记录发布前的公网首页哈希，记为 H0，回滚时用它对比（首次发布时没有）
curl -sS https://ethwar.ondream.ai/ | shasum -a 256
# c) 上传并预检，只会写入 DEPLOY_ROOT
deploy/push.sh $K.tar.gz preflight                                  # preflight OK (nothing was changed)
# d) 与基线比对，原始输出只存在 deploy/out/（首次发布时还没有基线，这一步跳过）
deploy/push.sh $K.tar.gz audit 2>&1 | tee deploy/out/audit-before-$ID.txt   # AUDIT OK
```

### 3.5 部署

```bash
deploy/push.sh $K.tar.gz deploy 2>&1 | tee deploy/out/deploy-$ID.txt
```

后续内容发布的预期输出里有：

- `nginx config unchanged … no reload`
- `current → releases/<ID>`
- `verify OK over https`

**首次发布**的预期不同：`baseline recorded`、`nginx config installed: ethwar.http.conf → … (other sites unchanged)`、`current → releases/<ID> (previous: none)`、`verify OK over http`、`deployed <ID> — http://ethwar.ondream.ai/ (https after 'cert')`，然后：

```bash
deploy/push.sh $K.tar.gz cert 2>&1 | tee deploy/out/cert-$ID.txt
```

预期 `nginx config installed: ethwar.https.conf → …`、`verify OK over https`、`HTTPS live: https://ethwar.ondream.ai/`。

任何 `ERROR`：脚本已经自动兜底（恢复配置或切回上一版），停下报告。

### 3.6 验收

```bash
deploy/push.sh $K.tar.gz audit 2>&1 | tee deploy/out/audit-after-$ID.txt   # AUDIT OK
diff deploy/out/audit-before-$ID.txt deploy/out/audit-after-$ID.txt         # 只能是 current / previous / releases 三行不同（首次发布无此项）
curl -sS https://ethwar.ondream.ai/ | shasum -a 256; shasum -a 256 $K/site/index.html   # 两者相同
curl -sS -o /dev/null -w '%{http_code}\n' http://ethwar.ondream.ai/            # 301
MOBILE_CHECK_URL=https://ethwar.ondream.ai pnpm verify:mobile
AUDIO_CHECK_URL='https://ethwar.ondream.ai/?sim&speed=0.01&range=99' pnpm verify:audio
```

音频检查要用这个低速、宽回合的受控 URL。用默认 URL 的话，公网下载音频期间模拟行情就会进入激战或胜利，A/B2/B3 会误报失败。访问统计的核对方法见本次手册。

### 3.7 回滚

| 情况 | 命令 |
| --- | --- |
| 新版本有问题，或用户不满意（第二次及以后发布） | `deploy/push.sh $K.tar.gz rollback`：`current` 切回上一版并自动校验，Nginx 不动 |
| 回滚后核对 | 公网首页哈希等于 H0；`audit` 与发布前一致 |
| 首次发布要撤 | 没有上一版，只能 `purge`（删除站点、配置和证书，验证回到基线）：**没有用户明确批准，不要运行** |

### 3.8 记录（入库前先过敏感检查）

- `docs/handoff/deploy.md` 顶部状态：写新版本号、源码提交、上一版。
- `docs/handoff/session-log.md`：新增一条，只写第 0 节允许的摘要。
- `docs/verification/README.md`：加一行生产验收记录。
- `verification/*.json` 和其他改动一起提交。
- 推送之前按第 2 节执行，`pnpm check:public` 必须通过。

## 4. 两件都授权时的推荐顺序

1. 提交代码，运行 `pnpm check:public`，然后 `git push`。这样线上运行的提交在 GitHub 上一定能找到。
2. 用这个提交打包、演练、发布、验收（第 3 节）。
3. 写发布记录，提交，运行 `pnpm check:public`，再 `git push`。

## 5. 停止条件汇总

| 阶段 | 情况 | 处理 |
| --- | --- | --- |
| 任意 | 用户没有授权当前这件事 | 不做，先问 |
| 推送 | `check:public` 失败，或钩子拒绝 | 不推送，按第 2 节处理 |
| 推送 | 本地落后于远端，或者历史对不上 | 停下，不要合并任何旧历史 |
| 发布 | 工作区不干净；测试或验证失败；演练失败 | 停下报告 |
| 发布 | 渲染出的 HTTPS 配置哈希与线上不同（第二次起） | 停下问用户：部署会重载共用 Nginx |
| 发布 | `preflight` 或 `audit` 出现 WARN 或 `AUDIT FOUND DIFFERENCES` | 停下，在对话里原样报告，不入库 |
| 发布 | 部署后首页哈希不一致、页面报错、`audit` 出现预期外的差异 | 回滚（首次发布：停下报告，等用户决定是否 `purge`） |
| 发布 | SSH 不通 | 停下，看 `private/docs/handoff/deploy.md` |

## 6. 汇报模板

```text
GitHub：main = <hash>（ls-remote 已核对），check:public OK（<N> 个提交），仓库可见性 PUBLIC
发布：<ID>（源码 <hash>），上一版 <ID 或「首次」>；公网首页 SHA-256 <hash> 与发布包一致
本机：pnpm test <n>/<n>；verify:mobile 24/24；verify:audio PASSED；演练 REHEARSAL PASSED
服务器：audit OK；nginx 未重载 / 首次发布重载两次（deploy、cert）
原始输出：deploy/out/audit-before-<ID>.txt、deploy-<ID>.txt、cert-<ID>.txt、audit-after-<ID>.txt（不入库）
```
