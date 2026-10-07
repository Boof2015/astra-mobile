export function settingsEntry(rows: readonly { id: string; disabled?: boolean }[], remembered?: string) {
  return rows.find(row => row.id === remembered && !row.disabled)?.id ?? rows.find(row => !row.disabled)?.id ?? null;
}

export function settingsWindow(index: number, count: number) {
  return Math.max(0, Math.min(index - 4, count - 6));
}

export function adjustSetting(value: number, direction: 'up' | 'down' | 'left' | 'right', min: number, max: number, step = 1) {
  return direction === 'left' || direction === 'right' ? Math.max(min, Math.min(max, value + (direction === 'right' ? step : -step))) : value;
}

/** Fixed-width pages keep legal text navigable with just Up/Down and Back. */
export function settingsTextPages(text: string): string[] {
  const lines = text.replace(/\r/g, '').split('\n').flatMap(line => {
    if (!line) return [''];
    const wrapped: string[] = []; let rest = line;
    while (rest.length > 84) {
      const space = rest.lastIndexOf(' ', 84); const end = space > 40 ? space : 84;
      wrapped.push(rest.slice(0, end)); rest = rest.slice(end).replace(/^ /, '');
    }
    return [...wrapped, rest];
  });
  return Array.from({ length: Math.max(1, Math.ceil(lines.length / 15)) }, (_, i) => lines.slice(i * 15, i * 15 + 15).join('\n'));
}
