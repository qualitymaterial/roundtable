export const palette = { obsidian: '#0B0D0D', graphite: '#1A1D1B', signal: '#39FF8B', bone: '#E6E6E6', slate: '#6B7280' } as const;
export type Theme = { inputBackground?: string; inputForeground?: string; accent?: string; border?: string; warning?: string; error?: string; ascii: boolean; color: boolean };
export function terminalTheme(env: NodeJS.ProcessEnv = process.env): Theme {
  const color = !('NO_COLOR' in env) && env.TERM !== 'dumb';
  const truecolor = /truecolor|24bit/i.test(env.COLORTERM ?? '');
  return { color, inputBackground: color ? truecolor ? palette.graphite : 'blackBright' : undefined, inputForeground: color ? truecolor ? palette.bone : 'white' : undefined, ascii: env.ROUNDTABLE_ASCII === '1', accent: color ? truecolor ? palette.signal : 'green' : undefined, border: color ? truecolor ? '#465249' : 'gray' : undefined, warning: color ? 'yellow' : undefined, error: color ? 'red' : undefined };
}
