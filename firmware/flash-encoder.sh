#!/bin/zsh
set -euo pipefail

CLI="${HOME}/.local/bin/arduino-cli"
SKETCH="$(cd "$(dirname "$0")" && pwd)/encoder_test"
FQBN="esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=16M,PSRAM=opi"

if [[ ! -x "$CLI" ]]; then
  echo "找不到 arduino-cli：$CLI"
  exit 1
fi

PORT="${1:-}"
if [[ -z "$PORT" ]]; then
  PORT="$(ls /dev/cu.usbmodem* /dev/cu.usbserial* /dev/cu.wchusbserial* 2>/dev/null | head -n 1 || true)"
fi
if [[ -z "$PORT" ]]; then
  echo "没有找到 ESP32。先用 USB 线把板子插上，再运行这个脚本。"
  exit 1
fi

echo "端口 $PORT"
"$CLI" compile --fqbn "$FQBN" "$SKETCH"
"$CLI" upload -p "$PORT" --fqbn "$FQBN" "$SKETCH"
echo "上传完成。转动或按下旋钮，下面会显示 CW、CCW、press、release。按 Ctrl-C 退出。"
"$CLI" monitor -p "$PORT" -c baudrate=115200
