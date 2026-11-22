import React, { useEffect, useState } from 'react';
import { VgfaSaveStore, type SaveSlotSummary } from '@vgfa/storage';

interface Props {
  saveStore: VgfaSaveStore;
  userId: string;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const SaveManagerModal: React.FC<Props> = ({ saveStore, userId, onClose }) => {
  const [saves, setSaves] = useState<SaveSlotSummary[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const list = await saveStore.listByUser(userId);
    setSaves(list);
  };

  useEffect(() => {
    void refresh();
  }, [userId]);

  const handleCreateMemoryCard = async (kind: 'memcard-ps1' | 'memcard-ps2') => {
    const data = VgfaSaveStore.createBlankMemoryCard(kind);
    await saveStore.put({
      userId,
      consoleId: kind === 'memcard-ps2' ? 'ps2' : 'ps1',
      gameId: kind === 'memcard-ps2' ? 'ps2-memcard-slot1' : 'ps1-memcard-slot1',
      gameTitle: kind === 'memcard-ps2' ? 'Memory Card PS2 (8 MB)' : 'Memory Card PS1 (128 KB)',
      kind,
      slot: 1,
      data,
    });
    setStatus(`Memory Card ${kind === 'memcard-ps2' ? 'PS2 (8 MB)' : 'PS1 (128 KB)'} criado no IndexedDB!`);
    await refresh();
  };

  const handleExport = async (item: SaveSlotSummary) => {
    const rec = await saveStore.getById(item.id);
    if (!rec) return;
    const ext = item.kind === 'memcard-ps2' ? 'ps2' : item.kind === 'memcard-ps1' ? 'mcr' : 'vgfasav';
    const copy = new Uint8Array(rec.data.byteLength);
    copy.set(rec.data);
    const blob = new Blob([copy], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.gameId}_slot${item.slot}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id: string) => {
    await saveStore.remove(id);
    await refresh();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Saves Locais & Memory Cards (IndexedDB)</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
          Seus saves ficam guardados localmente no navegador via <strong>IndexedDB</strong> (sem o limite de 5 MB do localStorage), incluindo suporte a Memory Cards <code>.ps2</code> de 8 MB compatíveis com PCSX2.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn btn-sm btn-cyan" onClick={() => handleCreateMemoryCard('memcard-ps2')}>
            + Novo Memory Card PS2 (8 MB)
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => handleCreateMemoryCard('memcard-ps1')}>
            + Novo Memory Card PS1 (128 KB)
          </button>
        </div>

        {status && (
          <div
            style={{
              padding: '8px 12px',
              marginBottom: 12,
              borderRadius: 10,
              background: 'rgba(52, 211, 153, 0.14)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              color: '#a7f3d0',
              fontSize: 12,
            }}
          >
            {status}
          </div>
        )}

        {saves.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
            Nenhum save encontrado ainda. Abra qualquer jogo e clique em <strong>Salvar Estado</strong> ou crie um Memory Card acima.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {saves.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'var(--bg-0)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{s.gameTitle}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {s.consoleId.toUpperCase()} • {s.kind} • Slot {s.slot} • {formatBytes(s.sizeBytes)} •{' '}
                    {new Date(s.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => handleExport(s)}>
                    Exportar
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ color: '#fb7185' }}
                    onClick={() => handleDelete(s.id)}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
