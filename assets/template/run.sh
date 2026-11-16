#!/bin/bash
# 在这个工程里运行命令（Mac / Linux）。如果建工程时下载了免安装版 Node.js，会自动用它。
# 例：./run.sh npm run panel      ./run.sh npm run render
cd "$(dirname "$0")"
if [ -f .node-dir ]; then export PATH="$(cat .node-dir):$PATH"; fi
exec "$@"
