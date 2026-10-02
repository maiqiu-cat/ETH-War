# tools/audio：配乐和音效的生成管线

游戏里的配乐和音效**全部由这里的脚本离线生成**，产物放在 `src/audio/assets/`（`*.m4a` 加 `manifest.json`）并已入库。所以平时构建不需要 Python，也不需要音色库，只有改声音时才用到这里。

| 文件 | 作用 |
| --- | --- |
| `compose.py` | 4 首配乐的编曲：M1 铁血进行曲、M2 暗涌、M3 破晓冲锋、M4 交易战线。同时提供 `Song`（音符和 CC 事件）、`render`（TinySoundFont 渲染）、`reverb`（FFT 卷积混响）、`shelf`（高频提亮）、`master`（响度和软限幅）。直接运行会生成试听版 |
| `sfx.py` | 多层音效合成：`rifle`、`mg_burst`、`sniper`、`cannon`、`explosion(size)`、`whistle`、`liquidation_strike`、`flare`；号角和号曲用音色库渲染（`horn_call`、`fanfare`）。直接运行会生成音效试听和实战混音 |
| `build_assets.py` | 导出游戏资源：平静曲 = M2 整曲无缝循环；激战曲 = M1 前奏一次，然后 4–32 小节循环；胜利 = M3 第 12–20 小节加 2.5 秒淡出；每种音效 1–6 个变体；最后写 `manifest.json` |

## 环境

```bash
cd tools/audio
python3 -m venv .venv && ./.venv/bin/pip install numpy==2.0.2 scipy==1.13.1
./.venv/bin/pip install --no-deps tinysoundfont==0.3.7   # 不装 pyaudio，只做离线渲染
```

tinysoundfont 0.3.7 用了 Python 3.10 的语法，本机是 3.9.6。要打两处补丁（只改 `.venv` 里的文件）：

```bash
SP=.venv/lib/python3.9/site-packages/tinysoundfont
for f in $SP/*.py; do grep -q "from __future__ import annotations" $f || { printf 'from __future__ import annotations\n' | cat - $f > $f.new && mv $f.new $f; }; done
python3 - <<'PY'
p = '.venv/lib/python3.9/site-packages/tinysoundfont/__init__.py'
s = open(p).read()
i = s.index('from .sequencer import ('); j = s.index(')', i) + 1
open(p, 'w').write(s[:i] + 'try:\n    ' + s[i:j].replace('\n', '\n    ') + '\nexcept SyntaxError:\n    pass' + s[j:])
PY
```

如果用的是 Python ≥3.10，就不需要这两处补丁。

## 音色库（MIT，215 MB，不入库）

```bash
mkdir -p .cache && curl -L -o .cache/MuseScore_General.sf2 \
  https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2
shasum -a 256 .cache/MuseScore_General.sf2
# 应为 ee51d2c4b1525e70f19a45909c4fd7a2e26d91d115fa89dbf5a6bc413d8b9bf3
```

许可证见 [`../../CREDITS.md`](../../CREDITS.md)：必须保留 FluidR3、FluidR3Mono 和 MuseScore_General 的版权声明。

## 生成

```bash
./.venv/bin/python build_assets.py                                # → src/audio/assets/（游戏用）
BB_DEMO_OUT=/tmp/demo ./.venv/bin/python compose.py /tmp/demo/music   # 4 首配乐试听
./.venv/bin/python sfx.py /tmp/demo/sfx /tmp/demo/music           # 音效试听 + 实战混音
```

脚本默认从 `tools/audio/.cache/MuseScore_General.sf2` 读音色库，也可以用环境变量 `BB_SOUNDFONT` 指定别的路径。

## 生成后必须做的检查

1. `pnpm test`：`tests/audio.test.ts` 会检查 manifest 里的每个文件都存在、循环参数合法、变体数量足够。
2. `pnpm build && pnpm verify:audio`：浏览器侧的完整检查，还会渲染 `verification/audio-preview.wav`。**一定要人工听一遍**。
3. 改了循环曲时，按 [docs/audio/README.md](../../docs/audio/README.md) 里「无缝循环」一节的方法检查接缝。

## 注意

- 编曲里的音符带随机人性化（`RNG` 有固定种子），同一份代码会生成同样的结果。改编曲后整首都会变，记得重新试听。
- 循环版会删掉 `loop_to_beat` 处的终止和弦。新加的段落如果在最后一拍放了重音，要同步检查。
- AAC 编码会在文件开头加几十毫秒的编码延迟。循环点在 manifest 里写的是 `loopStart = 起点 + 0.5 秒`，文件末尾多出 1 秒的周期延伸，所以浏览器无论是否裁掉这段延迟，循环都是无缝的。
