import { useEffect, useState } from 'react';
import { getLibraryEntry, listLibrary, onLibraryChange, type LibraryEntry } from '@vgfa/runtime';

/** Jogos baixados na biblioteca do aparelho (mais recentes primeiro). Atualiza sozinho. */
export function useLibraryEntries(): LibraryEntry[] {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void listLibrary().then((list) => {
        if (alive) setEntries(list);
      });
    };
    refresh();
    const off = onLibraryChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return entries;
}

/** O jogo desta URL na biblioteca, ou null se ainda não foi baixado. */
export function useLibraryEntry(url?: string): LibraryEntry | null {
  const [entry, setEntry] = useState<LibraryEntry | null>(null);

  useEffect(() => {
    let alive = true;
    if (!url) {
      setEntry(null);
      return undefined;
    }
    const refresh = () => {
      void getLibraryEntry(url).then((e) => {
        if (alive) setEntry(e);
      });
    };
    refresh();
    const off = onLibraryChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [url]);

  return entry;
}
