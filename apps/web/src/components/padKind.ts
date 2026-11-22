import type { ConnectedPadInfo } from '@vgfa/pad';

const LABELS: Record<ConnectedPadInfo['kind'], string> = {
  'phone-webrtc': 'Direto',
  'phone-relay': 'Pela internet',
  'phone-ws': 'Wi-Fi local',
  bluetooth: 'Bluetooth',
  keyboard: 'Teclado',
};

/** Rótulo amigável do tipo de conexão de um controle. */
export function padKindLabel(kind: ConnectedPadInfo['kind']): string {
  return LABELS[kind] ?? kind;
}
