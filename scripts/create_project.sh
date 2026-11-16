#!/bin/bash
# 用模板新建一个预览视频工程，并装好依赖。（Mac / Linux；Windows 用 create_project.ps1）
#
# 用法：create_project.sh <目标文件夹> [--install-node] [--install-ffmpeg]
#
# 需要两样东西：Node.js 22 以上、FFmpeg（导出视频用）。电脑上缺哪样：
#   不带对应参数：什么都不做，以退出码 3 结束，打印 NEED_NODE / NEED_FFMPEG，并说明需要下载什么。
#   带上对应参数：下载官方免安装包，按写死的校验码校验后解压到 ~/.app-preview-video/，
#                 只给这个 skill 用，不改动系统，不需要密码。
# 所以正确的顺序是：先不带参数运行 → 退出码 3 → 问用户同不同意下载 → 同意后带上参数再运行。
set -euo pipefail

NODE_VERSION="v22.11.0"
# 官方 SHASUMS256.txt 里的校验码，写死在这里：下载到的文件对不上就拒绝使用
node_sha() {
  case "$1" in
    darwin-arm64) echo 2e89afe6f4e3aa6c7e21c560d8a0453d84807e97850bbb819b998531a22bdfde ;;
    darwin-x64)   echo 668d30b9512137b5f5baeef6c1bb4c46efff9a761ba990a034fb6b28b9da2465 ;;
    linux-arm64)  echo 27453f7a0dd6b9e6738f1f6ea6a09b102ec7aa484de1e39d6a1c3608ad47aa6a ;;
    linux-x64)    echo 4f862bab52039835efbe613b532238b6e4dde98d139a34e6923193e073438b13 ;;
    *) echo "" ;;
  esac
}
# FFmpeg：GitHub 上 eugeneware/ffmpeg-static 项目 b6.1.1 版的静态编译包（FFmpeg 6.0），校验码取自 GitHub 公布的值
FFMPEG_TAG="b6.1.1"
ffmpeg_sha() {
  case "$1" in
    ffmpeg-darwin-arm64)  echo 8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa ;;
    ffprobe-darwin-arm64) echo d986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be ;;
    ffmpeg-darwin-x64)    echo 929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106 ;;
    ffprobe-darwin-x64)   echo d4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186 ;;
    ffmpeg-linux-arm64)   echo 754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0 ;;
    ffprobe-linux-arm64)  echo 2ab6aba60ee84412dff9188720703376cb4e7aaf7e0b5e43aa8249f2acae5bf8 ;;
    ffmpeg-linux-x64)     echo bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa ;;
    ffprobe-linux-x64)    echo 25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067 ;;
    *) echo "" ;;
  esac
}

TARGET=""; INSTALL_NODE=0; INSTALL_FFMPEG=0
for a in "$@"; do
  case "$a" in
    --install-node) INSTALL_NODE=1 ;;
    --install-ffmpeg) INSTALL_FFMPEG=1 ;;
    -*) echo "不认识的参数：$a"; exit 1 ;;
    *) TARGET="$a" ;;
  esac
done
if [ -z "$TARGET" ]; then echo "用法: $0 <目标文件夹> [--install-node] [--install-ffmpeg]"; exit 1; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -e "$TARGET" ]; then echo "目标已存在：$TARGET（为了不覆盖已有工程，请换一个文件夹名）"; exit 1; fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; *) ARCH=unknown ;; esac
PLAT="$OS-$ARCH"
APV_HOME="${APV_HOME:-$HOME/.app-preview-video}"
PRIVATE_NODE="$APV_HOME/node-$NODE_VERSION-$PLAT/bin"
PRIVATE_FFMPEG="$APV_HOME/ffmpeg-$FFMPEG_TAG-$PLAT"

sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }

# 1) 先看缺什么
NODE_DIR=""; NEED_NODE=0
if [ "${APV_IGNORE_SYSTEM_NODE:-0}" != 1 ] && command -v node >/dev/null 2>&1 && [ "$(node -p 'parseInt(process.versions.node)')" -ge 22 ]; then
  echo "使用系统里的 Node.js $(node -v)"
elif [ -x "$PRIVATE_NODE/node" ]; then
  NODE_DIR="$PRIVATE_NODE"; echo "使用之前下载的免安装版 Node.js $NODE_VERSION"
else
  NEED_NODE=1
fi
FFMPEG_DIR=""; NEED_FFMPEG=0
if [ "${APV_IGNORE_SYSTEM_FFMPEG:-0}" != 1 ] && command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  echo "使用系统里的 FFmpeg（$(command -v ffmpeg)）"
elif [ -x "$PRIVATE_FFMPEG/ffmpeg" ] && [ -x "$PRIVATE_FFMPEG/ffprobe" ]; then
  FFMPEG_DIR="$PRIVATE_FFMPEG"; echo "使用之前下载的免安装版 FFmpeg"
else
  NEED_FFMPEG=1
fi

ASK=0
if [ "$NEED_NODE" = 1 ] && [ "$INSTALL_NODE" != 1 ]; then
  if [ -z "$(node_sha "$PLAT")" ]; then echo "不支持的系统：$PLAT。请手动安装 Node.js 22 以上（https://nodejs.org）后再运行。"; exit 1; fi
  echo "NEED_NODE"
  echo "这台电脑上没有可用的 Node.js（需要 22 以上）。可以自动下载官方免安装版："
  echo "  https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$PLAT.tar.gz（约 45MB）"
  ASK=1
fi
if [ "$NEED_FFMPEG" = 1 ] && [ "$INSTALL_FFMPEG" != 1 ]; then
  if [ -z "$(ffmpeg_sha "ffmpeg-$PLAT")" ]; then echo "不支持的系统：$PLAT。请手动安装 FFmpeg 后再运行。"; exit 1; fi
  echo "NEED_FFMPEG"
  echo "这台电脑上没有 FFmpeg（导出视频要用）。可以自动下载静态编译版（FFmpeg 6.0）："
  echo "  https://github.com/eugeneware/ffmpeg-static/releases/tag/$FFMPEG_TAG 里的 ffmpeg-$PLAT.gz 和 ffprobe-$PLAT.gz（各约 20–30MB）"
  ASK=1
fi
if [ "$ASK" = 1 ]; then
  echo "下载后会按写死的校验码校验，解压到 $APV_HOME ，只给这个 skill 用，不改动系统，不需要管理员密码。"
  echo "请先征得用户同意，再加上 --install-node / --install-ffmpeg 重新运行。"
  exit 3
fi

# 2) 下载缺的东西
mkdir -p "$APV_HOME"
if [ "$NEED_NODE" = 1 ]; then
  FILE="node-$NODE_VERSION-$PLAT.tar.gz"
  echo "正在从 nodejs.org 下载 $FILE …"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$APV_HOME/$FILE" "https://nodejs.org/dist/$NODE_VERSION/$FILE"
  if [ "$(sha256 "$APV_HOME/$FILE")" != "$(node_sha "$PLAT")" ]; then
    rm -f "$APV_HOME/$FILE"; echo "Node.js 校验失败：下载到的文件和官方校验码对不上，已删除，没有使用。请重试，或手动安装。"; exit 1
  fi
  tar -xzf "$APV_HOME/$FILE" -C "$APV_HOME"; rm -f "$APV_HOME/$FILE"
  NODE_DIR="$PRIVATE_NODE"; echo "Node.js 校验通过"
fi
if [ "$NEED_FFMPEG" = 1 ]; then
  mkdir -p "$PRIVATE_FFMPEG"
  for b in ffmpeg ffprobe; do
    echo "正在从 GitHub 下载 $b-$PLAT.gz …"
    curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$PRIVATE_FFMPEG/$b.gz" "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_TAG/$b-$PLAT.gz"
    if [ "$(sha256 "$PRIVATE_FFMPEG/$b.gz")" != "$(ffmpeg_sha "$b-$PLAT")" ]; then
      rm -f "$PRIVATE_FFMPEG/$b.gz"; echo "FFmpeg 校验失败：下载到的文件和公布的校验码对不上，已删除，没有使用。请重试，或手动安装。"; exit 1
    fi
    gunzip -f "$PRIVATE_FFMPEG/$b.gz"; chmod +x "$PRIVATE_FFMPEG/$b"
    command -v xattr >/dev/null 2>&1 && xattr -d com.apple.quarantine "$PRIVATE_FFMPEG/$b" 2>/dev/null || true
  done
  curl -fsSL --proto '=https' -o "$PRIVATE_FFMPEG/LICENSE" "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_TAG/$PLAT.LICENSE" || true
  FFMPEG_DIR="$PRIVATE_FFMPEG"; echo "FFmpeg 校验通过"
fi
[ -n "$NODE_DIR" ] && export PATH="$NODE_DIR:$PATH"

# 3) 复制模板，装依赖
mkdir -p "$(dirname "$TARGET")"
cp -R "$HERE/../assets/template" "$TARGET"
cd "$TARGET"
chmod +x run.sh
# 用的是免安装版时，把位置记在工程里：run.sh 会带上 Node，导出脚本会找到 FFmpeg
[ -n "$NODE_DIR" ] && printf '%s' "$NODE_DIR" > .node-dir
[ -n "$FFMPEG_DIR" ] && printf '%s' "$FFMPEG_DIR" > .ffmpeg-dir
npm install --no-audit --no-fund

echo
echo "工程已建好：$(pwd)"
echo "启动控制台：./run.sh npm run panel   （默认 http://127.0.0.1:5173）"
echo "导出视频：  ./run.sh npm run render   （输出到 out/app-preview.mp4）"
