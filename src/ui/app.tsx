import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Text, Static, useInput, usePaste, useWindowSize, useApp, useCursor, measureElement, type DOMElement, type SuspendTerminal } from 'ink';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { graphemes, type PresentationController, type Entry, type Composer, type Presentation } from './controller.js';
import { type Theme } from './theme.js';

const decoration = (value: string, theme: Theme) => theme.ascii ? value.replace(/·/g, '/').replace(/…/g, '...') : value;
export function composerWindow(c: Composer, columns: number) {
  const chars = graphemes(c.text); const start = Math.max(0, c.cursor - Math.max(8, columns));
  const before = (start ? '…' : '') + chars.slice(start, c.cursor).join('').split('\n').slice(-3).join('\n');
  const current = chars[c.cursor] === '\n' ? ' ' : chars[c.cursor] ?? ' ';
  const after = (chars[c.cursor] === '\n' ? '\n' : '') + chars.slice(c.cursor + 1, c.cursor + Math.max(8, columns)).join('').split('\n').slice(0, 2).join('\n') + (c.cursor + columns < chars.length ? '…' : '');
  const options = { hard: true, trim: false, wordWrap: false };
  const rows = wrapAnsi(before + current, Math.max(4, columns), options).split('\n');
  return { text: wrapAnsi(before + current + after, Math.max(4, columns), options), x: stringWidth(rows.at(-1)!) - stringWidth(current), y: rows.length - 1 };
}

const asciiBorder = { topLeft: '+', top: '-', topRight: '+', left: '|', bottomLeft: '+', bottom: '-', bottomRight: '+', right: '|' };

export function MessageEntry({ entry, theme, width = 80 }: { entry: Entry; theme: Theme; width?: number }) {
  if (entry.kind === 'brand') return <Box flexDirection="column" marginTop={1} marginBottom={1}>
    <Box justifyContent="space-between"><Text bold>{theme.ascii ? 'o' : '◔'} {entry.title}</Text><Text dimColor={theme.color}>LOCAL</Text></Box>
    <Box marginTop={1}><Text color={theme.border}>{(theme.ascii ? '-' : '─').repeat(width)}</Text></Box>
    <Text dimColor={theme.color} wrap="truncate-middle">{entry.body}</Text>
  </Box>;
  if (entry.kind === 'session') return <Box flexDirection="column" marginBottom={1}>
    <Text dimColor={theme.color}>SESSION / {entry.title}</Text>
    <Text bold wrap="wrap">{entry.body}</Text>
  </Box>;
  const color = entry.kind === 'error' ? theme.error : entry.kind === 'approval' ? theme.warning : undefined;
  return <Box flexDirection="column" marginBottom={1}>
    {entry.title && <Text bold color={color}>{decoration(entry.kind === 'error' ? 'Error · ' : entry.kind === 'approval' ? 'Approval required · ' : '', theme)}{entry.title}{entry.model && <Text bold={false} dimColor={theme.color}>{decoration(` · ${entry.model}`, theme)}</Text>}</Text>}
    <Text wrap="wrap" dimColor={theme.color && entry.kind === 'activity'}>{entry.body}</Text>
  </Box>;
}
export function StatusLine({ state, theme }: { state: Presentation; theme: Theme }) {
  const stateLabel = state.state === 'active' ? '' : ` · ${state.state}`;
  return <Box justifyContent="space-between" marginTop={1} columnGap={1}>
    <Box flexShrink={1}><Text><Text color={state.state === 'active' ? theme.accent : theme.warning}>{theme.ascii ? '*' : '◉'}</Text><Text dimColor={theme.color}>{decoration(` ${state.agents} agents · ${state.tasks} tasks${stateLabel}`, theme)}</Text></Text></Box>
    <Text dimColor={theme.color}>/help</Text>
  </Box>;
}
export function PromptComposer({ composer: c, theme, columns }: { composer: Composer; theme: Theme; columns: number }) {
  const contentWidth = Math.max(4, columns - 6);
  const window = composerWindow(c, contentWidth); const ref = useRef<DOMElement>(null); const { setCursorPosition } = useCursor();
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  setCursorPosition({ x: origin.x + window.x, y: origin.y + window.y });
  useLayoutEffect(() => { if (ref.current) { const box = measureElement(ref.current); if (box.x !== origin.x || box.y !== origin.y) setOrigin({ x: box.x, y: box.y }); } });
  useEffect(() => () => { setCursorPosition(undefined); }, [setCursorPosition]);
  const choiceStart = Math.max(0, c.selected - 3);
  return <Box flexDirection="column" marginTop={1}>
    {c.mode !== 'chat' && <Text bold>{c.label}</Text>}
    <Box borderStyle={theme.ascii ? asciiBorder : 'round'} borderColor={theme.border} paddingX={1} width={columns}>
      <Text color={theme.accent}>{theme.ascii ? '> ' : '› '}</Text>
      <Box ref={ref} width={contentWidth}><Text wrap={c.text ? 'wrap' : 'truncate-end'} dimColor={theme.color && !c.text}>{c.text ? window.text : c.mode === 'chat' ? decoration('Send a message to the agents…', theme) : c.mode === 'pick' ? decoration('Search…', theme) : ' '}</Text></Box>
    </Box>
    {c.mode === 'pick' && <Box flexDirection="column" marginTop={1}>
      {c.choices.slice(choiceStart, choiceStart + 6).map((choice, i) => <Text key={choice.index} color={choiceStart + i === c.selected ? theme.accent : undefined} wrap="truncate-end">{choiceStart + i === c.selected ? '> ' : '  '}{choice.label}</Text>)}
      {!c.choices.length && <Text>No matching choices. Change the search.</Text>}
      <Text dimColor={theme.color}>{c.choices.length} choices · type to filter · arrows select · Enter confirms · Esc returns</Text>
    </Box>}
    {c.suggestions.length > 0 && <Text dimColor={theme.color} wrap="truncate-end">{c.suggestions.join('  ')} · Tab completes</Text>}
    {c.notice && <Text color={theme.warning}>{c.notice}</Text>}
    {c.mode === 'ask' && <Text dimColor={theme.color}>{c.secret ? 'Hidden input · Enter submits · Esc cancels' : 'Enter submits · Esc returns'}</Text>}
  </Box>;
}
export function RoundtableApp({ controller, theme, terminalReady, inputEnabled = true }: { controller: PresentationController; theme: Theme; terminalReady?: (suspend: SuspendTerminal) => void; inputEnabled?: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const { columns, rows } = useWindowSize(); const width = Math.max(12, Math.min(columns - 2, 100));
  const app = useApp();
  useEffect(() => { terminalReady?.(app.suspendTerminal); }, [app.suspendTerminal, terminalReady]);
  useInput((input, key) => controller.key(input, key), { isActive: inputEnabled && !state.closed });
  usePaste(text => controller.paste(text), { isActive: inputEnabled && !state.closed });
  return <Box flexDirection="column" width={width} marginLeft={columns > 14 ? 1 : 0}>
    <Static items={state.entries} style={{ width, marginLeft: columns > 14 ? 1 : 0 }}>{entry => <MessageEntry key={entry.id} entry={entry} theme={theme} width={width} />}</Static>
    {!state.closed && <Box flexDirection="column">
      {state.live.slice(-Math.max(1, Math.min(3, Math.floor((rows - 12) / 4)))).map(agent => <Box key={agent.id} flexDirection="column" marginTop={1}>
        <Text><Text bold>{agent.label}</Text><Text dimColor={theme.color}>{decoration(` · ${agent.running ? 'working' : 'responding'}${agent.model ? ` · ${agent.model}` : ''}`, theme)}</Text></Text>
        {agent.tool && <Text dimColor={theme.color}>{decoration(`  ${agent.tool} · ${agent.running ? `${agent.running} running` : 'completed'} · ${agent.done} done${agent.failed ? ` · ${agent.failed} failed` : ''}`, theme)}</Text>}
        {agent.text && rows > 18 && <Text wrap="wrap">{graphemes(agent.text.split('\n').slice(-3).join('\n')).slice(-width * 2).join('')}</Text>}
      </Box>)}
      {state.composer.mode !== 'idle' && <PromptComposer composer={state.composer} theme={theme} columns={width} />}
      {state.session && <StatusLine state={state} theme={theme} />}
    </Box>}
  </Box>;
}
