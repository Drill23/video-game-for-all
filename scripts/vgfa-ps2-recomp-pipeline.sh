#!/usr/bin/env bash
# =============================================================================
# VGFA PS2/PSP Static Recompilation Pipeline Helper (MIT Base)
# =============================================================================
# Este script automatiza a preparação local do pipeline de recompilação estática
# AOT (Emotion Engine MIPS -> C++ -> WebAssembly + WebGPU) baseado no projeto
# MIT `snuri00/ps2-web-recomp`, gerando módulos prontos para plugar no VGFA.
#
# IMPORTANTE: Use apenas cópias (ISOs) de jogos que você possui legalmente.
# Nunca versione binários gerados nem ISOs no repositório do VGFA.
# =============================================================================
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Uso: $0 <slug-do-jogo> <caminho-para-disc.iso>"
  echo "Exemplo: $0 meu-jogo ~/Jogos/PS2/MeuJogo.iso"
  exit 1
fi

GAME_SLUG="$1"
ISO_PATH="$2"
WORK_DIR="$(cd "$(dirname "$0")/.." && pwd)/.vgfa-recomp-work"

if [ ! -f "$ISO_PATH" ]; then
  echo "Erro: ISO não encontrada em $ISO_PATH"
  exit 1
fi

mkdir -p "$WORK_DIR"
if [ ! -d "$WORK_DIR/ps2-web-recomp" ]; then
  echo "[VGFA] Clonando base MIT snuri00/ps2-web-recomp em $WORK_DIR..."
  git clone --depth 1 https://github.com/snuri00/ps2-web-recomp.git "$WORK_DIR/ps2-web-recomp"
fi

echo "[VGFA] Iniciando recompilação AOT para WebAssembly + WebGPU: $GAME_SLUG"
cd "$WORK_DIR/ps2-web-recomp"
scripts/port.sh "$GAME_SLUG" "$ISO_PATH"

OUT_DIR="$WORK_DIR/ps2-web-recomp/build/web-$GAME_SLUG"
echo ""
echo "[VGFA] Build AOT concluído em: $OUT_DIR"
echo "[VGFA] Para servir localmente com headers COOP/COEP + HTTP Range:"
echo "  python3 $WORK_DIR/ps2-web-recomp/scripts/serve.py $OUT_DIR \"$ISO_PATH\""
