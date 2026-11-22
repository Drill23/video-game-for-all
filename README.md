# VIDEO GAME FOR ALL — VGFA

> **Do Atari 2600 ao PlayStation 2 direto no navegador** — com **Celular como Controle Adaptativo (QR Code)**, **Bluetooth Gamepad API**, **Streaming de Disco Virtual P2P/HTTP Range (`@vgfa/disc`)**, **Saves Locais Persistentes (IndexedDB)** e **Multi-idioma (PT-BR / EN / ES)**.

---

## Arquitetura do Sistema (Código Único VGFA)

Construído após a análise profunda de engenharia reversa dos projetos de referência (`snuri00/ps2-web-recomp`, `snuri00/psp-web-recomp`, `TabStationToo` e cores `libretro` WASM) — veja o relatório completo em [docs/ARCHITECTURE_ANALYSIS.md](docs/ARCHITECTURE_ANALYSIS.md) e a especificação dos protocolos em [docs/VGFA_PROTOCOL.md](docs/VGFA_PROTOCOL.md).

```
video-game-for-all/
├── docs/
│   ├── ARCHITECTURE_ANALYSIS.md   # Fase 0: análise real de TabStationToo, ps2-web-recomp e psp-web-recomp
│   └── VGFA_PROTOCOL.md           # Protocolo binário VGFA-Pad (16 bytes) e VGFA-Disc (SharedArrayBuffer)
├── packages/
│   ├── vgfa-disc/                 # Motor próprio de Streaming de Disco Virtual (HTTP Range + WebTorrent P2P + Sharded OPFS + ISO9660/PS2)
│   ├── vgfa-pad/                  # Controle Universal: Bluetooth Gamepad API + Celular via QR Code (WebRTC DataChannel + WS)
│   ├── vgfa-storage/              # Saves Locais em IndexedDB (Save States + Memory Cards PS1 .mcr / PS2 .ps2) + Perfis/Login
│   └── vgfa-runtime/              # Motor Multi-Console (Arcade Embutido 60 FPS + RetroArch WASM + Ponte PS2/PSP WebGPU)
├── apps/
│   ├── signaling-server/          # Servidor leve WebSocket + detecção automática de IP LAN para QR Code
│   └── web/                       # Portal VGFA (React + Vite + Headers COOP/COEP + rota /pad/:roomCode para celular)
└── scripts/
    ├── dev.mjs                    # Sobe servidor + portal juntos
    └── vgfa-ps2-recomp-pipeline.sh # Automação local de recompilação AOT PS2 (MIT)
```

---

## Como Rodar Localmente

Requisitos: **Node.js >= 20** e **pnpm >= 9**.

```bash
pnpm install
pnpm test
pnpm dev
```

- **Portal VGFA (PC / Mac / TV):** abra `http://localhost:5173` (contexto seguro com `COOP/COEP` ativo para `SharedArrayBuffer` e `WebGPU`).
- **Celular como Controle (iPhone / Android na mesma rede Wi-Fi):** abra qualquer jogo, clique em **Celular como Controle** e escaneie o **QR Code** (o servidor detecta automaticamente o IP LAN da sua máquina). O layout do celular se adapta automaticamente ao console ativo (**Atari CX40**, **NES**, **SNES**, **Mega Drive**, **GBA**, **N64**, **PS1**, **PSP** e **PS2 DualShock 2 com analógicos e pressão**).
- **Controle Bluetooth / USB:** basta parear no sistema e apertar qualquer botão no jogo.

---

## Pipeline PS2 WebGPU / WASM (AOT)

Para compilar localmente uma ISO de PS2 que você possui em um módulo WebAssembly + WebGPU de 60 FPS acoplável ao VGFA:

```bash
chmod +x scripts/vgfa-ps2-recomp-pipeline.sh
./scripts/vgfa-ps2-recomp-pipeline.sh meu-jogo /caminho/para/disc.iso
```

---

## Política Legal & Repositório Limpo

Este repositório contém **100% código próprio sob licença MIT** e jogos leves embutidos criados originalmente para o VGFA. **Nenhuma ROM, ISO ou BIOS proprietária é armazenada ou distribuída aqui.** Para jogos comerciais retrô/PS2, utilize apenas cópias pessoais locais (BYOD) ou acervos públicos/homebrew legalmente distribuíveis.
