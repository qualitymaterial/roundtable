import { Box, Text } from 'ink';
import { safeTerminalText } from '../terminal-ui.js';
import type { Theme } from './theme.js';

export function markdownLines(input: string) {
  let fence = false; let language = '';
  return safeTerminalText(input).split('\n').map(line => {
    if (/^\s*```/.test(line)) { fence = !fence; language = fence ? line.trim().slice(3) : ''; return { kind: 'label', text: fence ? language || 'code' : '' }; }
    if (fence) return { kind: language === 'diff' && /^[+-]/.test(line) ? line[0] === '+' ? 'add' : 'remove' : 'code', text: line };
    if (/^#{1,6} /.test(line)) return { kind: 'heading', text: line.replace(/^#{1,6} /, '') };
    if (/^>\s?/.test(line)) return { kind: 'quote', text: line };
    return { kind: 'prose', text: line };
  });
}
function Inline({ text }: { text: string }) {
  return <Text>{text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <Text key={i} bold>{part.slice(2, -2)}</Text>;
    if (part.startsWith('`') && part.endsWith('`')) return <Text key={i} underline>{part.slice(1, -1)}</Text>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    return <Text key={i}>{link ? `${link[1]} (${link[2]})` : part}</Text>;
  })}</Text>;
}
/** Render source, never execute HTML, OSC hyperlinks or terminal controls. */
export function Markdown({ text, theme }: { text: string; theme: Theme }) {
  return <Box flexDirection="column">{markdownLines(text).map((line, i) => <Text key={i} wrap="wrap" bold={line.kind === 'heading'} dimColor={theme.color && ['label', 'quote'].includes(line.kind)} color={line.kind === 'add' ? theme.accent : line.kind === 'remove' ? theme.error : undefined}>
    {line.kind === 'prose' ? <Inline text={line.text} /> : line.text || ' '}
  </Text>)}</Box>;
}
