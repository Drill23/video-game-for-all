/** Formatadores pt-BR compartilhados (Minha Central, aviso de retomada). */

export function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  const w = Math.floor(d / 7);
  if (d < 30) return `há ${w} ${w === 1 ? 'semana' : 'semanas'}`;
  const m = Math.floor(d / 30);
  if (m < 12) return `há ${m} ${m === 1 ? 'mês' : 'meses'}`;
  const y = Math.floor(d / 365);
  return `há ${y} ${y === 1 ? 'ano' : 'anos'}`;
}

/** 95 min → "1 h 35 min"; 40 s → "menos de 1 min". */
export function formatPlayTime(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
