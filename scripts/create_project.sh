#!/bin/bash
# 用模板新建一个预览视频工程，并装好依赖。（Mac / Linux；Windows 用 create_project.ps1）
#
# 用法：create_project.sh <目标文件夹> [--install-node]
#
# 需要 Node.js 18 以上。电脑上没有时：
#   不带 --install-node：什么都不做，以退出码 3 结束，并说明需要下载什么。
#   带 --install-node  ：从 nodejs.org 下载官方免安装包（约 45MB），校验后解压到
#                        ~/.app-preview-video/ 里，只给这个 skill 用，不改动系统，不需要密码。
# 所以正确的顺序是：先不带参数运行 → 退出码 3 → 问用户同不同意下载 → 同意后加 --install-node 再运行。
set -euo pipefail

NODE_VERSION="v22.11.0"
# 官方 SHASUMS256.txt 里的校验码，写死在这里：下载到的文件对不上就拒绝使用
sha_for() {
  case "$1" in
    darwin-arm64) echo 2e89afe6f4e3aa6c7e21c560d8a0453d84807e97850bbb819b998531a22bdfde ;;
    darwin-x64)   echo 668d30b9512137b5f5baeef6c1bb4c46efff9a761ba990a034fb6b28b9da2465 ;;
    linux-arm64)  echo 27453f7a0dd6b9e6738f1f6ea6a09b102ec7aa484de1e39d6a1c3608ad47aa6a ;;
    linux-x64)    echo 4f862bab52039835efbe613b532238b6e4dde98d139a34e6923193e073438b13 ;;
    *) echo "" ;;
  esac
}

TARGET=""; INSTALL=0
for a in "$@"; do
  case "$a" in
    --install-node) INSTALL=1 ;;
    -*) echo "不认识的参数：$a"; exit 1 ;;
    *) TARGET="$a" ;;
  esac
done
if [ -z "$TARGET" ]; then echo "用法: $0 <目标文件夹> [--install-node]"; exit 1; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -e "$TARGET" ]; then echo "目标已存在：$TARGET（为了不覆盖已有工程，请换一个文件夹名）"; exit 1; fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; *) ARCH=unknown ;; esac
PLAT="$OS-$ARCH"
APV_HOME="${APV_HOME:-$HOME/.app-preview-video}"
PRIVATE_NODE="$APV_HOME/node-$NODE_VERSION-$PLAT/bin"

# 1) 找 Node：先用系统里的（18 以上），再找之前下载过的免安装版
NODE_DIR=""
if [ "${APV_IGNORE_SYSTEM_NODE:-0}" != 1 ] && command -v node >/dev/null 2>&1 && [ "$(node -p 'parseInt(process.versions.node)')" -ge 18 ]; then
  echo "使用系统里的 Node.js $(node -v)"
elif [ -x "$PRIVATE_NODE/node" ]; then
  NODE_DIR="$PRIVATE_NODE"
  echo "使用之前下载的免安装版 Node.js $NODE_VERSION"
else
  SHA="$(sha_for "$PLAT")"
  if [ -z "$SHA" ]; then echo "不支持的系统：$PLAT。请手动安装 Node.js 18 以上（https://nodejs.org）后再运行。"; exit 1; fi
  FILE="node-$NODE_VERSION-$PLAT.tar.gz"
  URL="https://nodejs.org/dist/$NODE_VERSION/$FILE"
  if [ "$INSTALL" != 1 ]; then
    echo "NEED_NODE"
    echo "这台电脑上没有可用的 Node.js（需要 18 以上）。"
    echo "可以自动下载官方免安装版：$URL（约 45MB），"
    echo "解压到 $APV_HOME ，只给这个 skill 用，不改动系统，不需要管理员密码。"
    echo "请先征得用户同意，再加上 --install-node 重新运行。"
    exit 3
  fi
  mkdir -p "$APV_HOME"
  echo "正在从 nodejs.org 下载 $FILE …"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$APV_HOME/$FILE" "$URL"
  if command -v shasum >/dev/null 2>&1; then GOT="$(shasum -a 256 "$APV_HOME/$FILE" | cut -d' ' -f1)"; else GOT="$(sha256sum "$APV_HOME/$FILE" | cut -d' ' -f1)"; fi
  if [ "$GOT" != "$SHA" ]; then
    rm -f "$APV_HOME/$FILE"
    echo "校验失败：下载到的文件和官方校验码对不上，已删除，没有使用。"
    echo "可能是网络问题或下载被拦截。请重试，或手动安装 Node.js。"
    exit 1
  fi
  tar -xzf "$APV_HOME/$FILE" -C "$APV_HOME"
  rm -f "$APV_HOME/$FILE"
  NODE_DIR="$PRIVATE_NODE"
  echo "校验通过，已解压到 $APV_HOME/node-$NODE_VERSION-$PLAT"
fi
[ -n "$NODE_DIR" ] && export PATH="$NODE_DIR:$PATH"

# 2) 复制模板，装依赖
mkdir -p "$(dirname "$TARGET")"
cp -R "$HERE/../assets/template" "$TARGET"
cd "$TARGET"
chmod +x run.sh
# 用的是免安装版时，把它的位置记在工程里，run.sh 会自动带上
[ -n "$NODE_DIR" ] && printf '%s' "$NODE_DIR" > .node-dir
npm install --no-audit --no-fund

echo
echo "工程已建好：$(pwd)"
echo "启动控制台：./run.sh npm run panel   （默认 http://127.0.0.1:5173）"
echo "其他命令也都通过 ./run.sh 运行，例如：./run.sh npx remotion still src/index.ts AppPreview f.jpg --frame=60"
