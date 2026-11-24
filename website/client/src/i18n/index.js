import uk from './uk.json';
import en from './en.json';

export const LOCALES = { uk, en };

export function formatUtcToLocal(utcString) {
  if (!utcString) return '—';
  const d = new Date(utcString);
  if (Number.isNaN(d.getTime())) return utcString;
  return d.toLocaleString('uk-UA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
