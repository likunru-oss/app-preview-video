@echo off
rem Run a command inside this project (Windows). Uses the portable Node.js if one was downloaded at setup.
rem Example:  run.cmd npm run panel
cd /d "%~dp0"
if exist .node-dir set /p NODE_DIR=<.node-dir
if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"
%*
