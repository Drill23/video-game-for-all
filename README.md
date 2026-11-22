# VIDEO GAME FOR ALL — VGFA

> **Loja e Plataforma Web Multi-Console (Atari 2600 ao PlayStation 2)** — com **Capas e Fichas Reais**, **Emuladores WebAssembly Reais**, **Celular como Controle Adaptativo (QR Code)**, **Bluetooth Gamepad API**, **Proxy CORS-Free / Streaming de Disco (`@vgfa/disc`)**, **Saves em IndexedDB** e **Multi-idioma (PT-BR / EN / ES)**.

---

## O que já está funcionando (v0.2)

- **Loja / Catálogo VGFA com 52 Títulos e Capas Reais:**
  - **44 Clássicos Lendários** do Atari 2600 ao PlayStation 2 (*Dragon Ball Z: Budokai Tenkaichi 3*, *GTA: San Andreas*, *God of War II*, *Resident Evil 4*, *Gran Turismo 4*, *Shadow of the Colossus*, *Super Mario World*, *Chrono Trigger*, *Crash Bandicoot*, *Super Mario 64*, *Sonic 2*, *Pokémon Emerald*, *River Raid* e mais) com capa real, nota, ano, desenvolvedora, sinopse, serial (`SLUS-21678`) e filtro/busca instantânea.
  - **8 ROMs Reais Grátis & Open-Source (1 Clique)** rodando em emuladores WebAssembly reais (**Snes9x**, **FCEUmm**, **mGBA**, **Genesis Plus GX** e **Stella**).
- **Motor Multi-Console Unificado:**
  - **NES, SNES, Mega Drive, GBA, PS1:** RetroArch WebAssembly (`nostalgist`) com barra de progresso real e injeção direta do controle pelo celular.
  - **Atari 2600, Nintendo 64 e PSP:** EmulatorJS WebAssembly (`stella2014`, `mupen64plus_next`, `ppsspp-thread-wasm`).
  - **PlayStation 2:** Hub dedicado com **`@vgfa/disc`** (leitura de ISO de 4,5 GB por chunks de 256 KiB + Cache OPFS Sharded + parser `SYSTEM.CNF`), **`TabStationToo` (PCSX2 WebGPU 60 FPS)**, **`Play!.js` (Zero-BIOS WASM)** e script AOT [vgfa-ps2-recomp-pipeline.sh](scripts/vgfa-ps2-recomp-pipeline.sh).
- **Proxy CORS-Free + Busca no Internet Archive:**
  - `/api/proxy/stream`: streaming HTTP 206 Byte Ranges sem bloqueio CORS/COEP.
  - `/api/archive/search` e `/api/archive/files`: identifica automaticamente ROMs/ISOs diretas vs arquivos `.zip`/`.7z` grandes ou bloqueados por login na origem.
  - **Fontes Pessoais (URL ou Manifesto `.json`)**: vincule sua biblioteca pessoal diretamente aos jogos da loja.
- **Celular como Controle Adaptativo (`/pad/:roomCode`) + Bluetooth:**
  - Protocolo binário de **16 bytes** via WebRTC DataChannel + WebSocket binário.
  - Skins adaptativas automáticas para todos os 9 consoles (do **Atari CX40** ao **PS2 DualShock 2** com 2 analógicos virtuais, pressão L2/R2 e vibração).

---

## Arquitetura do Monorepo

Veja o relatório técnico da Fase 0 em [docs/ARCHITECTURE_ANALYSIS.md](docs/ARCHITECTURE_ANALYSIS.md) e a especificação dos protocolos em [docs/VGFA_PROTOCOL.md](docs/VGFA_PROTOCOL.md).

```
video-game-for-all/
├── docs/                      # Análise de engenharia reversa + especificações VGFA-Disc & VGFA-Pad
├── packages/
│   ├── vgfa-disc/             # Streaming VirtualChunkedDisc (HTTP Range + WebTorrent P2P + OPFS Sharded + ISO9660 + SAB 64-bit)
│   ├── vgfa-pad/              # Codec binário 16-byte + 9 layouts adaptativos + Gamepad API + WebRTC/WS Host & Client
│   ├── vgfa-storage/          # IndexedDB Save States + Memory Cards PS1 (.mcr) e PS2 8 MB (.ps2) + Contas/Perfis
│   └── vgfa-runtime/          # Loja (52 títulos) + Emuladores WASM (RetroArch + EmulatorJS) + Ponte PS2 WebGPU
├── apps/
│   ├── signaling-server/      # Salas WebSocket/WebRTC + IP LAN automático + Proxy CORS-Free + API Internet Archive
│   └── web/                   # Portal Loja VGFA (React + Vite + COOP/COEP + rota mobile /pad/:roomCode)
└── scripts/
    ├── dev.mjs
    └── vgfa-ps2-recomp-pipeline.sh
```

---

## Como Rodar Localmente

Requisitos: **Node.js >= 20** e **pnpm >= 9**.

```bash
pnpm install
pnpm test
pnpm dev
```

- **Loja & Player:** abra `http://localhost:5173`
- **Celular como Controle:** clique em **Celular como Controle** dentro de qualquer jogo e escaneie o QR Code na mesma rede Wi-Fi.

---

## Política Legal & Repositório Limpo

Este repositório contém **100% código próprio (MIT)** e metadados/capas de repositórios abertos. **Nenhuma ROM ou ISO comercial protegida por direitos autorais é hospedada ou distribuída neste repositório.** Para jogos comerciais, use suas cópias pessoais (BYOD) ou fontes próprias configuradas localmente.
