#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Repository } from './storage.js';
import { Engine } from './engine.js';
import { ProviderRegistry } from './providers.js';
import { PiAdapter } from './pi-adapter.js';
import { verifyCollaboration } from './acceptance.js';
import { mockStream, registerMock, runDemo, demoObjective, validateMemoryArtifact } from './demo.js';
import { AgentInput, redact, type AgentRecord, type Artifact, type SessionRecord } from './domain.js';
import type { ToolProvider } from './tools.js';
import { HostAccess, hostCapabilities, normalizeHostPolicy, listCheckpoints, undoCheckpoint, previewCheckpoint } from './host-tools.js';
import type { Approval } from './domain.js';
import { InkTerminal } from './ui/terminal.js';
import { TerminalUI } from './terminal-ui.js';
import { budgetHelp } from './budgets.js';
import { setup, saveJson } from './setup.js';
import { completionReport, resolveFailure, executionExitCode } from './completion.js';
import { usageReport } from './usage.js';
import { stageStatus, advanceStage } from './policy.js';
import { tasksView, artifactsView, summaryView, usageView, transcriptView, activityView } from './views.js';
import { Attachments } from './attachments.js';
import { SQLiteArtifactStore, artifactBytes } from './artifacts.js';
import { VERSION } from './version.js';
import { KnowledgeStore } from './knowledge.js';
import { workflows, loadWorkflow } from './workflows.js';
import { WindowsReleases } from './releases.js';
import { createInput, choose, type TerminalInput, type MenuIO } from './input.js';
import { loginFlow, selectModel, favoritesMenu, providerBrowser, providerRow, modelRow, type ModelChoice } from './auth-ui.js';
import { readSettings, saveSettings } from './settings.js';
import { editLimit, mcpMenu, skillsMenu } from './preferences-ui.js';
import { Skills } from './skills.js';
import { commandEntries, commandPicker, recentSessions, sessionPicker } from './navigation.js';
import { connectionReport, diagnosticsMenu, endpointMenu } from './connection-ui.js';
import { captureSession, writeBundle, readBundle, restoreBundle } from './session-bundles.js';
import { editDraft, mentionedFiles } from './composer.js';
import { ProjectProfiles } from './projects.js';

const userHome = join(homedir(), '.roundtable');
const configFile = join(userHome, 'config.json');
const userConfig = !process.env.ROUNDTABLE_HOME && existsSync(configFile) ? z.object({ dataDir: z.string().min(1), projectAccess: z.boolean().default(false) }).strict().parse(JSON.parse(readFileSync(configFile, 'utf8'))) : undefined;
const home = resolve(process.env.ROUNDTABLE_HOME ?? userConfig?.dataDir ?? userHome);
function projectAccessEnabled(): boolean {
  const path = join(home, 'preferences.json');
  return existsSync(path) ? z.object({ projectAccess: z.boolean() }).strict().parse(JSON.parse(readFileSync(path, 'utf8'))).projectAccess : userConfig?.projectAccess ?? false;
}
const inkMode = Boolean(stdin.isTTY && stdout.isTTY) && !process.argv.includes('--json') && (!process.argv[2] || ['setup', 'settings', 'login', 'endpoints', 'diagnostics', 'favorites', 'providers', 'models', 'workflow', 'demo'].includes(process.argv[2]) || process.argv[2] === 'session' && ['new', 'resume'].includes(process.argv[3] ?? ''));
const ui = inkMode ? new InkTerminal(readSettings(home).view) : new TerminalUI(stdout, Boolean(stdout.isTTY), Boolean(stdout.isTTY) && !('NO_COLOR' in process.env), process.env.ROUNDTABLE_ASCII === '1', readSettings(home).view);
const print = (value: unknown) => ui.print(value);
const menu = (title: string, rows: string[], hint?: string) => ui.menu(title, rows, hint);
function transcript(engine?: Engine, repo?: Repository): (activity: unknown) => void {
  return activity => {
    const a = activity as { type: string; intermediate?: boolean; delta?: string; agentId?: string; name?: string; result?: unknown; error?: string; text?: string; message?: { sender: string; body: string; recipients: string[] } };
    const agentId = a.agentId ?? a.message?.sender ?? '';
    const agent = engine?.agents().find(x => x.id === agentId) ?? repo?.get<AgentRecord>('agent', agentId);
    if (ui instanceof InkTerminal) {
      if (engine) ui.summary(engine.session(), engine.agents(), engine.repo.list<{ state: string }>('task', engine.sessionId).filter(t => !['done', 'cancelled'].includes(t.state)).length);
      else if (repo && agent) { const session = repo.get<SessionRecord>('session', agent.sessionId); if (session) ui.summary(session, repo.list<AgentRecord>('agent', session.id), repo.list<{ state: string }>('task', session.id).filter(t => !['done', 'cancelled'].includes(t.state)).length); }
      if (a.type === 'approval' && engine) { const pending = engine.repo.list<Approval>('approval', engine.sessionId).filter(x => x.state === 'pending').at(-1); if (pending) ui.approval(pending, agent?.name); }
      else ui.receive(a, agent);
      if (engine) for (const pending of engine.repo.list<Approval>('approval', engine.sessionId).filter(x => x.state === 'pending')) ui.pendingApproval(pending, engine.agents().find(member => member.id === pending.agentId)?.name);
      return;
    }
    const label = agent ? `${agent.name} [${agent.provider}/${agent.model}]` : (a.agentId ?? a.message?.sender ?? 'system');
    if (a.type === 'stream') { ui.stream(label, a.delta ?? ''); return; }
    if (a.type === 'paused') { ui.paused(a.text ?? 'Paused', budgetHelp); return; }
    if (a.type === 'message') {
      const recipients = stdout.isTTY ? a.message!.recipients.map(id => engine?.agents().find(x => x.id === id)?.name ?? id) : a.message!.recipients;
      ui.message(label, a.message!.body, recipients, a.message!.sender === 'human', a.intermediate);
    }
    else if (a.type === 'tool') ui.tool(label, a.name!);
    else if (a.type === 'tool_result') ui.tool(label, a.name!, a.result);
    else if (a.type === 'approval' && engine && stdout.isTTY) {
      const pending = engine.repo.list<Approval>('approval', engine.sessionId).filter(x => x.state === 'pending').at(-1);
      if (pending) ui.approval(pending);
    }
    else { if (a.type === 'error') ui.flushActivity(); print(`[${a.type}] ${label}: ${a.error ?? a.text ?? ''}`); }
  };
}
const help = `Roundtable — independent agents, shared objectives
roundtable [--agents config.json]   Start with saved agents; live admission uses provider requests
roundtable init | doctor | providers | models [provider] | login <provider> [oauth|api_key]
roundtable setup | settings      Guided setup and saved configuration
roundtable workflows | workflow <name-or-json-file> [--agents config.json]
roundtable releases | rollback <installed-release-id>   Windows standalone releases
roundtable run <objective> --agents config.json   Headless newline-delimited JSON events
roundtable session new <objective> [--agents config.json]
roundtable session list | resume [id] | export <id> [path]
roundtable session backup <id> <path> | import <path> [project-folder]
roundtable endpoints | diagnostics | favorites
roundtable demo                 Deterministic model fixtures using three real Pi sessions
roundtable demo --live config.json  Three configured live providers; may incur provider charges
roundtable demo --live config.json --check  Local configuration preflight; no inference
roundtable validate <session-id>    Independently validate the memory demo artifact
roundtable session verify <id>     Check persisted collaboration acceptance without inference

Interactive commands:
/commands [search]              Search commands; / alone opens the picker
/view [compact|verbose]         Compact activity panels or full live trace; saves preference
/sessions                      Search and open saved sessions, paused for inspection
/favorites | /endpoints | /diagnostics | /tuning
/agents | /add-agent [JSON] | /remove-agent <id> | /pause-agent <id> | /resume-agent <id>
/replace-agent <id> <provider> <model>
/providers | /models [provider]   Browse accounts/models and apply to a participant
/task-transfer <task-id> <agent-name|open>
/queue | /steer <new instruction>
/rename [name] | /archive | /draft
/backup [path] | /fork [name] | /import [path]
/project                        Review project instructions, lineup and defaults
/audience | /attach [path] | /attachments
/board
/tools | /tasks | /artifacts | /artifact | /messages [search] | /activity [search]
/settings | /model [participant] | /login [provider] [oauth|api_key] | /logout [provider]
/mcp-reconnect [server]         Drop connections; next authorized call reconnects
/skills [list|add|toggle|remove] | /skill:<name> <request> | /mcp [list|add|manage]
/send <name-or-id> <message> | ordinary text broadcasts to all members
/status | /pause | /resume | /retry | /budget | /limits <JSON>
/resolve-failure <failure-id> <reason>
/stage | /next-stage
/summary | /finish <completion note> | /context [agent] | /compact <agent>
/changes | /diff <checkpoint-id> | /undo <checkpoint-id>
/paste                          Compose multiple lines; /end sends, /cancel-paste discards
/editor                         Edit a saved draft; review before sending
/editor-config                  Choose editor executable and arguments without shell syntax
Use @path or @"path with spaces" to attach project files; Tab completes paths.
/jobs | /job <id> | /stop-job <id>
/usage                          Per-participant token components and estimated cost
/remember <text> | /memory [query] | /share-memory <id> | /forget <id>
/budget tokens <total|off> | /budget dollars <total> | /budget requests|tools|exchanges <total>
/approvals | /approve <request-id> | /reject <request-id>
/host | /host-read <absolute-folder> | /host-write <absolute-folder>
/host-shell on|off | /host-off | /save-access
/grant <agent-id> <capability> | /revoke <agent-id> <capability>
/export [path] | /save-agents | /load-tool <trusted-module-path> | /help | /exit
Example /add-agent {"name":"My agent","provider":"openrouter","model":"ID from /models","instructions":"Choose your own approach"}`;

async function login(registry: ProviderRegistry, provider?: string, type?: string, existing?: TerminalInput): Promise<void> {
  const input = existing ?? terminalInput(); const abort = new AbortController();
  const cancel = () => abort.abort(); input.rl.on('SIGINT', cancel); input.rl.on('close', cancel);
  try { await loginFlow(registry, { select: input.select, ask: (label, secret, signal) => input.ask(label, secret, AbortSignal.any([abort.signal, ...(signal ? [signal] : [])])), print, menu }, provider, type, readSettings(home).openBrowser, undefined, abort.signal); }
  finally { input.rl.off('SIGINT', cancel); input.rl.off('close', cancel); if (!existing) input.rl.close(); }
}
function terminalInput(): TerminalInput {
  const commands = () => [...new Set(help.match(/\/[a-z-]+/g)), ...new Skills(home).list().filter(s => s.enabled).map(s => `/skill:${s.name}`)];
  return ui instanceof InkTerminal ? ui.input(commands) : createInput(commands);
}
function startupAgents(registry: ProviderRegistry, explicitPath?: string, announce = true): z.output<typeof AgentInput>[] {
  const profile = explicitPath ? undefined : new ProjectProfiles(home, process.cwd()).read();
  const path = explicitPath ? resolve(explicitPath) : [join(home, 'agents.json'), join(home, 'live-agents.json')].find(existsSync);
  if (!path && !profile?.agents?.length) return [];
  const configs = z.array(AgentInput.strict()).min(1).max(64).parse(profile?.agents?.length ? profile.agents : JSON.parse(readFileSync(path!, 'utf8')));
  const available = configs.filter(config => {
    try {
      registry.model(config.provider, config.model);
      if (!registry.providers().some(p => p.id === config.provider && p.configured)) throw new Error(`No Roundtable authentication for ${config.provider}; use /login or configure its supported environment variable`);
      return true;
    } catch (error) { if (explicitPath) throw error; if (announce) print(`Saved participant ${config.name} is unavailable: ${String(error)}. Repair it using /settings or /project.`); return false; }
  });
  if (announce) print(ui.compact ? `Connecting ${available.length} participants (two metered compatibility requests each).` : `Loading ${available.length} agents from ${profile?.agents?.length ? 'your saved project lineup' : path}. Admission makes two provider requests per agent; provider charges or quotas may apply.`);
  return available;
}
async function configureHost(engine: Engine, input: unknown, quiet = false): Promise<void> {
  const policy = await normalizeHostPolicy(input); const session = engine.session();
  session.hostAccess = policy;
  session.permissions = [...new Set([...session.permissions.filter(p => !p.startsWith('host.')), ...hostCapabilities(policy)])];
  engine.repo.put('session', session);
  for (const agent of engine.agents()) {
    agent.permissions = [...new Set([...agent.permissions.filter(p => !p.startsWith('host.')), ...hostCapabilities(policy)])]; engine.repo.put('agent', agent);
  }
  for (const approval of engine.repo.list<Approval>('approval', engine.sessionId)) {
    if (approval.command && ['pending', 'approved'].includes(approval.state)) { approval.state = 'rejected'; engine.repo.put('approval', approval); }
  }
  engine.repo.event(engine.sessionId, 'human_host_policy_changed', policy); if (!quiet) ui.host(policy);
}
async function interactive(repo: Repository, registry: ProviderRegistry, sessionId: string, configs: z.output<typeof AgentInput>[] = [], input = terminalInput(), projectFolder?: string, inspectOnly = false): Promise<string | undefined> {
  await registerMock(registry);
  const engine = new Engine(repo, sessionId, async (agent, current) => PiAdapter.create(registry, agent, current, agent.provider === 'roundtable-mock' ? mockStream : undefined));
  const { rl, lines } = input;
  let nextSession: string | undefined;
  const attachments = new Attachments(repo, sessionId);
  const projectRoot = engine.session().projectRoot ?? engine.session().workspace;
  input.setProjectRoot(projectRoot);
  let audience = repo.get<{ recipients: string[] }>('draft', `${sessionId}:audience`)?.recipients ?? ['*'];
  const selectedRecipients = () => audience.includes('*') ? engine.agents().filter(a => a.state !== 'removed').map(a => a.id) : audience;
  const checkImages = (snapshots: { mimeType: string }[], recipients: string[]) => {
    if (snapshots.some(a => a.mimeType.startsWith('image/')) && recipients.some(id => { const a = participant(id); return !registry.model(a.provider, a.model).input.includes('image'); })) throw new Error('An audience model does not support images. Snapshots saved, but nothing sent. Choose an image-capable audience.');
  };
  const sendHuman = async (body: string) => {
    const files = mentionedFiles(body, projectRoot); const recipients = selectedRecipients();
    const snapshots = files.length ? await attachments.addFiles(files, recipients) : [];
    checkImages(snapshots, recipients);
    return engine.send({ sessionId, sender: 'human', recipients: audience, type: 'human', body, ...(snapshots.length ? { attachments: snapshots.map(a => a.id) } : {}) });
  };
  const menuIO: MenuIO = { ask: input.ask, select: input.select, print, menu };
  const selectParticipant = () => choose(menuIO, 'Participant', engine.agents().filter(a => a.state !== 'removed'), a => `${a.name} (${a.provider}/${a.model}, ${a.state})`);
  const saveParticipants = () => { const entries = engine.agents().filter(a => a.state !== 'removed').map(({ name, provider, model, instructions, permissions, effort, maxOutputTokens, contextWindowTokens }) => ({ name, provider, model, instructions, permissions, effort, maxOutputTokens, contextWindowTokens })); if (entries.length) saveJson(join(home, 'agents.json'), entries); };
  const changeModel = async (reference = '', selectedModel?: ModelChoice) => {
    const a = reference ? participant(reference.replace(/^"(.*)"$/, '$1')) : await selectParticipant();
    const selected = selectedModel ?? await selectModel(registry, menuIO);
    if (selected.provider === a.provider && selected.id === a.model) { print('That model is already selected.'); return; }
    print(`Changing ${a.name} to ${selected.provider}/${selected.id} makes paid compatibility probes and sends its existing context to that provider on future turns.`);
    if ((await input.ask('Apply to this participant? [y/N]')).toLowerCase() !== 'y') return;
    await engine.changeModel(a.id, selected.provider, selected.id); print('Model changed. Participant ID, context history, tasks and permissions retained.');
    if ((await input.ask('Save current participants as the startup configuration too? [y/N]')).toLowerCase() === 'y') saveParticipants();
  };
  const addParticipant = async () => {
      const selected = await selectModel(registry, menuIO); const name = await input.ask('Participant name'); const instructions = await input.ask('Instructions (blank for none)');
      print('Connecting makes metered model compatibility probes.');
      if ((await input.ask('Connect this participant? [y/N]')).toLowerCase() === 'y') { await engine.addAgent({ name, instructions, provider: selected.provider, model: selected.id, permissions: ['collaborate', 'memory', 'artifact', ...hostCapabilities(HostAccess.parse(engine.session().hostAccess ?? {}))] }); if ((await input.ask('Save participants for future sessions? [y/N]')).toLowerCase() === 'y') saveParticipants(); }
      };
  const disconnectEndpoint = async (provider: string) => {
    const affected = engine.agents().filter(a => a.provider === provider && a.state !== 'removed');
    if (!affected.length) return;
    await engine.pause('Endpoint configuration changed'); await engine.idle();
    for (const agent of affected) await engine.setAgentState(agent.id, 'paused');
  };
  const settingsMenu = async () => {
    const saved = readSettings(home); ui.settings(saved.limits, saved.openBrowser, home, engine.session().limits);
    const action = await choose(menuIO, 'Settings', ['participant model', 'add participant', 'provider login', 'current session limits', 'new session defaults', 'browser opening', 'MCP connections', 'skills', 'save participants', 'folder access', 'back', 'model favorites', 'local/custom endpoint', 'connection diagnostics'], s => s);
    if (action === 'participant model') await changeModel();
    else if (action === 'provider login') await login(registry, undefined, undefined, input);
    else if (action === 'add participant') await addParticipant();
    else if (action === 'current session limits') { engine.updateLimits(await editLimit(menuIO, engine.session().limits)); print('Applied to this session; usage was not reset. Resume explicitly if paused.'); }
    else if (action === 'new session defaults') { saveSettings(home, { ...saved, limits: { ...saved.limits, ...await editLimit(menuIO, saved.limits) } }); print('Saved for new sessions. Existing sessions are unchanged.'); }
    else if (action === 'browser opening') { saveSettings(home, { ...saved, openBrowser: !saved.openBrowser }); print(`Automatic browser opening: ${!saved.openBrowser}`); }
    else if (action === 'MCP connections') { await mcpMenu(home, menuIO); await engine.connections.disconnect(); }
    else if (action === 'skills') await skillsMenu(home, menuIO);
    else if (action === 'model favorites') await favoritesMenu(registry, menuIO);
    else if (action === 'local/custom endpoint') await endpointMenu(registry, menuIO, disconnectEndpoint);
    else if (action === 'connection diagnostics') await diagnosticsMenu(registry, menuIO);
    else if (action === 'save participants') { saveParticipants(); print('Startup participants saved.'); }
    else if (action === 'folder access') {
      const access = await choose(menuIO, `Replace host roots for ${engine.session().projectRoot ?? engine.session().workspace}`, ['none', 'read', 'edit'] as const, v => v);
      const shell = (await input.ask('Allow exact command requests with unsandboxed OS privileges? [y/N]')).toLowerCase() === 'y';
      const policy = { readRoots: access === 'none' ? [] : [engine.session().projectRoot ?? engine.session().workspace], writeRoots: access === 'edit' ? [engine.session().projectRoot ?? engine.session().workspace] : [], shell }; print(policy);
      if ((await input.ask('Apply to this session and its participants? [y/N]')).toLowerCase() === 'y') {
        await configureHost(engine, policy);
        if ((await input.ask('Save as the host policy for future sessions? [y/N]')).toLowerCase() === 'y') { saveJson(join(home, 'host-access.json'), engine.session().hostAccess); saveJson(join(home, 'preferences.json'), { projectAccess: false }); }
      }
    }
  };
  const knowledge = new KnowledgeStore(repo, engine.session().projectRoot ?? engine.session().workspace);
  ui.attach(input.legacyReadline);
  engine.on('activity', transcript(engine));
  const refresh = ui instanceof InkTerminal ? setInterval(() => {
    if (ui instanceof InkTerminal) ui.summary(engine.session(), engine.agents(), repo.list<{ state: string }>('task', sessionId).filter(t => !['done', 'cancelled'].includes(t.state)).length, repo.deliveries(sessionId, ['inflight']).map(d => d.agentId));
  }, 500) : undefined;
  refresh?.unref();
  let pasted: string[] | undefined;
  const saveDraft = () => repo.put('draft', { id: sessionId, sessionId, body: redact(pasted?.join('\n') ?? '') } as { id: string; sessionId: string });
  if (repo.get<{ body: string }>('draft', sessionId)?.body) print('An unsent draft is saved. /draft restores it.');
  const interrupt = () => { pasted = undefined; void engine.pause('Interrupted by human (Ctrl-C)').catch(error => print(`[error] ${String(error)}`)); };
  rl.on('SIGINT', interrupt);
  const participant = (reference: string) => {
    const matches = engine.agents().filter(a => a.state !== 'removed' && (a.id === reference || a.name.toLowerCase() === reference.replace(/^@/, '').toLowerCase() || (reference.length >= 8 && a.id.startsWith(reference))));
    if (matches.length !== 1) throw new Error('Use a unique participant name or ID. Put names containing spaces in double quotes. /agents lists participants.');
    return matches[0]!;
  };
  try {
    if (inspectOnly && engine.session().state === 'active') await engine.pause('Opened for inspection. Use /resume to connect and continue.');
    repo.event(sessionId, 'human_session_opened', {});
    ui.banner(projectFolder ?? process.cwd(), home); ui.session(engine.session());
    const initial = engine.session();
    if ((new ProjectProfiles(home, projectRoot).read()?.instructions || initial.importedProjectInstructions) && !initial.projectInstructions) print('Saved project instructions are available. /project lets you inspect and apply their snapshot.');
    if (!ui.compact) print(`Session limits: tokens ${initial.limits.tokens ?? 'off'}, estimated cost $${initial.limits.dollars}, requests ${initial.limits.requests}, tools ${initial.limits.toolCalls}. /budget shows all limits.`);
    const accessPath = join(home, 'host-access.json');
    if (!engine.session().sourceSession && !engine.session().hostAccess && existsSync(accessPath)) await configureHost(engine, JSON.parse(readFileSync(accessPath, 'utf8')), true);
    if (projectFolder && projectAccessEnabled()) {
      const policy = HostAccess.parse(engine.session().hostAccess ?? {}); policy.writeRoots.push(projectFolder); await configureHost(engine, policy, true);
    }
    ui.startupAccess(HostAccess.parse(engine.session().hostAccess ?? {}));
    if (!ui.compact && engine.session().hostAccess?.shell) print('Host shell requires approval for each exact command. It runs with your OS user privileges; it is not sandboxed.');
    const withHostPermissions = (config: z.input<typeof AgentInput>) => ({ ...config, permissions: [...new Set([...(config.permissions ?? ['collaborate', 'memory', 'artifact']), ...hostCapabilities(HostAccess.parse(engine.session().hostAccess ?? {}))])] });
    for (const config of configs) {
      if (!ui.compact) print(`[connecting] ${config.name} [${config.provider}/${config.model}]`);
      try { await engine.addAgent(withHostPermissions(config)); }
      catch (error) { print(`[error] ${config.name}: ${String(error)}`); }
    }
    await engine.connect();
    const active = engine.agents().filter(a => a.state === 'active');
    if (!ui.compact) for (const agent of active) print(`[${engine.session().state === 'paused' ? 'saved participant' : 'connected'}] ${agent.name} [${agent.provider}/${agent.model}]`);
    if (stdout.isTTY) ui.startupAgents(active);
    if (inspectOnly && ui instanceof InkTerminal) {
      const recent = repo.messages(sessionId, undefined, 12).filter(m => m.sender === 'human' || !m.recipients.length).slice(-6);
      if (recent.length) ui.menu('Recent conversation · restored', ['/messages shows the full persisted history.']);
      for (const message of recent) ui.receive({ type: 'message', message }, engine.agents().find(a => a.id === message.sender));
    }
    if (engine.session().state === 'paused') ui.paused(engine.session().reason ?? 'Session paused', budgetHelp);
    else print(active.length ? `${active.length} agents ready. Type a message to talk to them, or /help for commands.` : 'No agents connected. Use /add-agent to choose a provider/model and connect, or /login to sign in.');
    while (true) {
      if (ui instanceof InkTerminal) ui.summary(engine.session(), engine.agents(), repo.list<{ state: string }>('task', sessionId).filter(t => !['done', 'cancelled'].includes(t.state)).length);
      ui.prompt(); const next = await lines.next(); ui.submitted(); if (next.done) break;
      let line = next.value.trim();
      if (pasted) {
        if (line === '/cancel-paste') { pasted = undefined; saveDraft(); print('Draft discarded.'); continue; }
        if (line !== '/end') {
          if (pasted.join('\n').length + next.value.length + 1 > 24000) { print('Draft limit is 24,000 characters. Use /end or /cancel-paste.'); continue; }
          pasted.push(next.value); saveDraft(); continue;
        }
        line = pasted.join('\n'); pasted = undefined;
        try {
          if (line.trim()) {
            if (!engine.agents().some(a => a.state === 'active')) throw new Error('No active participants. Draft was not sent.');
            await sendHuman(line); saveDraft();
          }
        } catch (error) { pasted = line.split('\n'); saveDraft(); print(`[error] ${String(error)}. Draft retained; /end retries, /cancel-paste discards.`); }
        continue;
      }
      if (line === '/draft') { pasted = (repo.get<{ body: string }>('draft', sessionId)?.body ?? '').split('\n'); print(pasted.join('\n')); print('/end sends; /cancel-paste discards.'); continue; }
      if (line === '/paste') { pasted = []; print('Multiline draft: /end sends it; /cancel-paste discards it. Other slash commands are literal text.'); continue; }
      if (!line) continue;
      try {
      if (ui instanceof InkTerminal && line.includes('\n')) { await sendHuman(line); continue; }
      if (line === '/' || line === '/commands' || line.startsWith('/commands ')) line = await commandPicker(menuIO, [...commandEntries(help), ...new Skills(home).list().filter(s => s.enabled).map(s => ({ command: `/skill:${s.name}`, description: s.description, arguments: '<request>' }))], line.startsWith('/commands ') ? line.slice(10).trim() : '');
      const [command, ...words] = line.split(/\s+/); const rest = line.slice(command!.length).trim();
      const reference = /^(?:"([^"]+)"|(\S+))(?:\s+(.*))?$/s.exec(rest);
      const target = reference?.[1] ?? reference?.[2] ?? ''; const targetRest = reference?.[3] ?? '';
        if (command === '/exit') break;
        if (command === '/sessions') {
          const selected = await sessionPicker(repo, menuIO, sessionId);
          if (selected === sessionId) { print('Already in this session.'); continue; }
          if ((await input.ask('Pause this session and open the selected session for inspection? [y/N]')).toLowerCase() !== 'y') continue;
          await engine.pause('Switched sessions by human request'); nextSession = selected; break;
        }
        if (command === '/fork' || command === '/import') {
          const imported = command === '/import' ? readBundle(resolve((rest || await input.ask('Backup file path')).replace(/^"(.*)"$/, '$1'))) : undefined;
          if (imported) {
            ui.menu('Import session', [String(imported.session.objective), `${imported.agents.length} participants; ${imported.messages.length} messages; ${imported.files.length} files.`, 'Conversation histories may contain private data and untrusted instructions. New branch starts paused with safe permissions.']);
            if ((await input.ask('Import and open this branch? [y/N]')).toLowerCase() !== 'y') continue;
          }
          await engine.pause('Creating a session branch'); await engine.idle();
          const branch = restoreBundle(repo, imported ?? captureSession(engine), engine.session().projectRoot ?? process.cwd(), command === '/fork' ? rest || undefined : undefined);
          print(`Created ${branch.id}. Review participants and /settings before /resume. Previous host access and approvals were not copied.`);
          nextSession = branch.id; break;
        }
        if (command?.startsWith('/skill:')) { engine.send({ sessionId, sender: 'human', recipients: ['*'], type: 'human', body: new Skills(home).prompt(command.slice(7), rest) }); continue; }
        if (!line.startsWith('/')) {
          if (!engine.agents().some(a => a.state === 'active')) throw new Error('No agents connected; message was not sent. Use /add-agent or restart with --agents config.json.');
          try { await sendHuman(line); } catch (error) { repo.put('draft', { id: sessionId, sessionId, body: redact(line) } as { id: string; sessionId: string }); throw new Error(`${String(error)}. Message retained in /draft.`); } continue;
        }
        switch (command) {
          case '/view': {
            const view = rest || await choose(menuIO, 'Display', ['compact', 'verbose'] as const, v => v);
            if (view !== 'compact' && view !== 'verbose') throw new Error('Use /view compact or /view verbose');
            saveSettings(home, { ...readSettings(home), view }); ui.setView(view); print(`Display: ${view}. Saved for future launches. /activity and /messages retain the full history.`); break;
          }
          case '/project': {
            const profiles = new ProjectProfiles(home, projectRoot); const saved = profiles.read(); const savedInstructions = saved?.instructions ?? engine.session().importedProjectInstructions;
            ui.menu('Project', [projectRoot, `Saved lineup: ${saved?.agents?.length ?? 0} participants`, `Instructions: ${engine.session().projectInstructions ? 'applied to this session' : saved?.instructions ? 'saved; not applied' : 'none'}`, 'Repository instructions are never loaded automatically. Saved lineups do not grant host or execution access.']);
            const action = await choose(menuIO, 'Project action', ['Review instruction file', 'Apply saved instruction snapshot', 'Save current lineup and limits', 'Clear current session instructions', 'Forget saved project profile', 'Back'], a => a);
            if (action === 'Review instruction file' || action === 'Apply saved instruction snapshot') {
              const snapshot = action === 'Review instruction file' ? profiles.candidate(resolve(projectRoot, (await input.ask('Instruction file [AGENTS.md]')).trim() || 'AGENTS.md')) : savedInstructions;
              if (!snapshot) throw new Error('No reviewed instruction snapshot has been saved');
              ui.menu('Review project instructions', [snapshot.source, `Snapshot hash: ${snapshot.hash}`, snapshot.content, 'These instructions will be sent to the session participants. They do not grant tools or access.']);
              if ((await input.ask('Apply and save this reviewed snapshot? [y/N]')).toLowerCase() === 'y') {
                await engine.pause('Project instructions changed'); await engine.idle(); const state = engine.session(); state.projectInstructions = snapshot; repo.put('session', state); profiles.save({ instructions: snapshot });
                repo.event(sessionId, 'project_instructions_reviewed', { source: snapshot.source, hash: snapshot.hash }); print('Reviewed snapshot applied. /resume continues with these instructions.');
              }
            } else if (action === 'Save current lineup and limits') {
              const agents = engine.agents().filter(a => a.state !== 'removed').map(({ name, provider, model, instructions, effort, maxOutputTokens, contextWindowTokens }) => ({ name, provider, model, instructions, effort, maxOutputTokens, contextWindowTokens }));
              profiles.save({ agents, limits: engine.session().limits }); print('Saved for new sessions launched in this exact folder. Explicit --agents takes precedence.');
            } else if (action === 'Clear current session instructions') {
              await engine.pause('Project instructions cleared'); await engine.idle(); const state = engine.session(); delete state.projectInstructions; repo.put('session', state); repo.event(sessionId, 'project_instructions_cleared', {}); print('Future prompts omit the instructions. Existing agent histories may still contain them.');
            } else if (action === 'Forget saved project profile') { profiles.forget(); print('Saved defaults removed. Existing sessions and their instructions are unchanged.'); }
            break;
          }
          case '/editor-config': {
            const executable = (await input.ask('Editor executable (full path or command; no shell syntax)')).replace(/^"(.*)"$/, '$1'); const args: string[] = [];
            print('For VS Code, add --wait. Enter each argument separately; blank finishes. The draft path is appended automatically.');
            while (args.length < 20) { const argument = await input.ask('Editor argument (blank to finish)'); if (!argument) break; args.push(argument); }
            saveSettings(home, { ...readSettings(home), editor: { executable, args } }); print('Editor saved. /editor opens a draft.'); break;
          }
          case '/editor': {
            const editor = readSettings(home).editor ?? { executable: process.platform === 'win32' ? 'notepad.exe' : 'nano', args: [] };
            await engine.pause('Editing a draft'); await engine.idle();
            const previous = repo.get<{ body: string }>('draft', sessionId)?.body ?? '';
            const result = await input.suspend(() => editDraft(home, previous, editor));
            pasted = result.body.split('\n'); saveDraft(); print(result.body);
            if (result.recoveryPath) print(`Editor returned without a successful changed draft. Recovery file: ${result.recoveryPath}. If its window is still open, finish editing there and configure a wait argument (for example VS Code --wait) using /editor-config.`);
            print(`Draft saved${result.exitCode !== 0 ? ` (editor exit ${result.exitCode})` : ''}. Review it; /end queues it, /cancel-paste discards. /resume after composing continues agents.`); break;
          }
          case '/backup': {
            await engine.pause('Creating a session backup'); await engine.idle();
            const bundle = captureSession(engine); const path = resolve((rest || `roundtable-${sessionId}.rtbundle`).replace(/^"(.*)"$/, '$1'));
            writeBundle(bundle, path); print(`Saved private session backup: ${path}. ${bundle.excluded.length} file paths excluded. Keep it private: it contains conversation and file contents. /resume continues.`); break;
          }
          case '/audience': {
            const options = [{ id: '*', name: 'All participants (broadcast)' }, ...engine.agents().filter(a => a.state !== 'removed')];
            ui.menu('Message audience', options.map((a, i) => `${i + 1}. ${a.name}`));
            const indices = (await input.ask('Choose one or more numbers separated by commas')).split(',').map(v => Number(v.trim()) - 1);
            if (!indices.length || indices.some(i => !Number.isInteger(i) || !options[i])) throw new Error('Choose displayed participant numbers');
            audience = indices.includes(0) ? ['*'] : [...new Set(indices.map(i => options[i]!.id))];
            repo.put('draft', { id: `${sessionId}:audience`, sessionId, recipients: audience } as { id: string; sessionId: string });
            print(`Messages will go to: ${audience.map(id => options.find(a => a.id === id)?.name).join(', ')}`); break;
          }
          case '/attach': {
            const paths = [rest || await input.ask('File path (PDF, Office, image, text or code)')];
            if (!rest) while (paths.length < 16) { const extra = await input.ask('Another file path (blank to continue)'); if (!extra.trim()) break; paths.push(extra); }
            const recipients = selectedRecipients();
            if (!recipients.length) throw new Error('Add a participant before attaching files');
            print(`Selected audience: ${recipients.map(id => participant(id).name).join(', ')}`);
            const attached = await attachments.addFiles(paths.map(path => resolve(projectRoot, path.replace(/^"(.*)"$/, '$1'))), recipients);
            checkImages(attached, recipients);
            const body = await input.ask('Request for these files');
            engine.send({ sessionId, sender: 'human', recipients, type: 'human', body, attachments: attached.map(a => a.id) }); break;
          }
          case '/attachments': {
            const entry = await choose(menuIO, 'Input snapshots', attachments.list(), a => `${a.name} (${a.mimeType}, ${a.bytes} bytes)`);
            ui.menu(entry.name, [`Hash: ${entry.hash}`, `Shared with: ${entry.recipients.map(id => participant(id).name).join(', ')}`, ...(entry.mimeType === 'text/plain' ? [Buffer.from(attachments.read(entry.id).data, 'base64').toString('utf8')] : [attachments.read(entry.id).extraction?.text ?? 'Binary image snapshot preserved.', ...(attachments.read(entry.id).extraction?.warnings ?? [])])]);
            ui.menu('Version history', attachments.lineage(entry.id).map(a => `${a.createdAt}  ${a.name}  ${a.hash.slice(0, 12)}`));
            const action = await choose(menuIO, 'Snapshot action', ['back', 'export', 'add revised version'], a => a);
            if (action === 'export') attachments.export(entry.id, resolve(await input.ask('Destination path')));
            if (action === 'add revised version') {
              const path = await input.ask('Revised file path'); const [added] = await attachments.addFiles([resolve(projectRoot, path.replace(/^"(.*)"$/, '$1'))], entry.recipients, entry.id);
              if (!added) throw new Error('No snapshot created');
              print(`Saved ${added.name} as a new version. Previous snapshots are unchanged.`);
              if ((await input.ask('Send this version to its original audience? [y/N]')).toLowerCase() === 'y') { checkImages([added], added.recipients); engine.send({ sessionId, sender: 'human', recipients: added.recipients, type: 'human', body: await input.ask('Request for this version'), attachments: [added.id] }); }
            }
            break;
          }
          case '/steer': {
            const recipients = selectedRecipients(); if (!recipients.length) throw new Error('Add a participant before steering');
            const result = await engine.steer(rest || await input.ask('New instruction for the selected audience'), recipients);
            print(`Steering ${result.steering} running participant(s) at the next tool boundary; ${result.queued} queued for their next turn. /pause stops running work.`); break;
          }
          case '/queue': {
            const queued = engine.queuedHumanMessages(); if (!queued.length) { print('No queued human messages.'); break; }
            const selected = await choose(menuIO, 'Queued messages', queued, m => m.body.replace(/\s+/g, ' ').slice(0, 100));
            const action = await choose(menuIO, 'Queue action', ['edit', 'move to back', 'cancel delivery', 'back', 'move before another message'], s => s);
            if (action === 'cancel delivery') { engine.cancelQueued(selected.id); print('Pending delivery cancelled. Original text remains in history.'); }
            else if (action === 'move before another message') {
              await engine.pause('Reordering pending messages'); await engine.idle();
              const current = engine.queuedHumanMessages(); const before = await choose(menuIO, 'Place before', current.filter(m => m.id !== selected.id), m => m.body.replace(/\s+/g, ' ').slice(0, 100));
              const keys = current.map(m => m.id).filter(key => key !== selected.id); keys.splice(keys.indexOf(before.id), 0, selected.id); engine.reorderQueue(keys);
              print('Delivery order saved. Transcript order is unchanged. /resume continues.');
            }
            else if (action !== 'back') {
              const body = action === 'edit' ? await input.ask('Replacement message') : selected.body;
              const recipients = repo.deliveries(sessionId).filter(d => d.messageId === selected.id).map(d => d.agentId);
              engine.send({ sessionId, sender: 'human', type: 'human', body, recipients, attachments: selected.attachments, correlationId: selected.id }, selected.id);
              print('Queued message replaced and moved to the back. Already delivered copies are not changed.');
            }
            break;
          }
          case '/rename': {
            const name = rest || await input.ask('Session name'); if (name.length > 120 || !name.trim()) throw new Error('Use a name of 1–120 characters');
            const s = engine.session(); s.name = redact(name.trim()); repo.put('session', s); repo.event(sessionId, 'session_renamed', { name: s.name }); print('Session renamed.'); break;
          }
          case '/archive': {
            await engine.pause('Archived by human'); const s = engine.session(); s.archived = true; repo.put('session', s); print('Archived. You can still resume it by session ID.'); return undefined;
          }
          case '/help': print(help); break;
          case '/stage': print(stageStatus(engine) ?? 'Free collaboration: no stage gates.'); break;
          case '/next-stage': advanceStage(engine); print('Stage approved.'); break;
          case '/settings': await settingsMenu(); break;
          case '/tuning': {
            const a = await selectParticipant(); const m = registry.model(a.provider, a.model);
            const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai/compat');
            const effort = await choose(menuIO, 'Reasoning effort', getSupportedThinkingLevels(m), e => e);
            const maxOutputTokens = Number(await input.ask(`Output token ceiling [${a.maxOutputTokens ?? m.maxTokens}]`) || a.maxOutputTokens || m.maxTokens);
            const contextWindowTokens = Number(await input.ask(`Context window ceiling [${a.contextWindowTokens ?? m.contextWindow}]`) || a.contextWindowTokens || m.contextWindow);
            const controls = AgentInput.parse({ ...a, effort, maxOutputTokens, contextWindowTokens });
            if ((await input.ask('Apply controls? Reconnection validates tool compatibility with metered requests [y/N]')).toLowerCase() !== 'y') break;
            await engine.changeModel(a.id, a.provider, a.model, controls);
            if ((await input.ask('Save participant defaults too? [y/N]')).toLowerCase() === 'y') saveParticipants();
            print('Model controls applied.'); break;
          }
          case '/commands': print('Use /commands <search> or / to open the picker.'); break;
          case '/favorites': await favoritesMenu(registry, menuIO); break;
          case '/endpoints': await endpointMenu(registry, menuIO, disconnectEndpoint); break;
          case '/diagnostics': await diagnosticsMenu(registry, menuIO); break;
          case '/model': await changeModel(rest); break;
          case '/login': await login(registry, words[0], words[1], input); break;
          case '/logout': {
            const provider = words[0] ?? (await choose(menuIO, 'Provider', registry.providers().filter(p => p.configured), p => p.id)).id;
            print('Logout removes only Roundtable-stored authentication. Environment keys and provider-side access remain.');
            if ((await input.ask(`Log out ${provider}? [y/N]`)).toLowerCase() === 'y') { await registry.runtime.logout(provider); print('Stored authentication removed.'); } break;
          }
          case '/skills': await skillsMenu(home, menuIO, rest); break;
          case '/mcp': await mcpMenu(home, menuIO, rest); await engine.connections.disconnect(); break;
          case '/mcp-reconnect': await engine.connections.disconnect(rest || undefined); print('MCP connections closed. The next authorized operation reconnects; previous calls are not replayed.'); break;
          case '/agents': ui.agents(engine.agents()); break;
          case '/add-agent': if (rest) { await engine.addAgent(withHostPermissions(AgentInput.parse(JSON.parse(rest)))); ui.agents(engine.agents()); } else await addParticipant(); break;
          case '/host': ui.host(HostAccess.parse(engine.session().hostAccess ?? {})); break;
          case '/host-read': case '/host-write': {
            const policy = HostAccess.parse(engine.session().hostAccess ?? {});
            const key = command === '/host-read' ? 'readRoots' : 'writeRoots';
            policy[key].push(rest.replace(/^"(.*)"$/, '$1')); await configureHost(engine, policy); break;
          }
          case '/host-shell': {
            if (!['on', 'off'].includes(rest)) throw new Error('Use /host-shell on|off');
            const policy = HostAccess.parse(engine.session().hostAccess ?? {}); policy.shell = rest === 'on';
            await configureHost(engine, policy); if (policy.shell) print('Exact commands require human approval and run unsandboxed with your OS user privileges.'); break;
          }
          case '/host-off': await configureHost(engine, {}); break;
          case '/save-access': {
            const path = join(home, 'host-access.json'); writeFileSync(path, JSON.stringify(HostAccess.parse(engine.session().hostAccess ?? {}), null, 2)); print(`Saved host policy to ${path} for future sessions.`); break;
          }
          case '/save-agents': {
            const configs = engine.agents().filter(a => a.state !== 'removed').map(({ name, provider, model, instructions, permissions, effort, maxOutputTokens, contextWindowTokens }) => ({ name, provider, model, instructions, permissions, effort, maxOutputTokens, contextWindowTokens }));
            if (!configs.length) throw new Error('No agents to save');
            const path = join(home, 'agents.json'); writeFileSync(path, JSON.stringify(configs, null, 2)); print(`Saved ${configs.length} agents to ${path} for future sessions.`); break;
          }
          case '/remove-agent': await engine.setAgentState(participant(target).id, 'removed'); break;
          case '/pause-agent': await engine.setAgentState(participant(target).id, 'paused'); break;
          case '/resume-agent': await engine.setAgentState(participant(target).id, 'active'); break;
          case '/replace-agent': {
            const old = participant(target); const [provider, model] = targetRest.split(/\s+/);
            if (!provider || !model) throw new Error('Use /replace-agent <name-or-id> <provider> <model>');
            await engine.changeModel(old.id, provider, model); print('Model changed; participant identity and history retained.'); break;
          }
          case '/providers':
          case '/models': {
            const provider = command === '/models' ? words.find(w => w !== '--json') : undefined;
            if (words.includes('--json')) print(command === '/providers' ? registry.providers() : registry.models(provider));
            else await providerBrowser(registry, menuIO, { login: p => login(registry, p, undefined, input), apply: m => changeModel('', m) }, provider, command === '/models');
            break;
          }
          case '/board': {
            const entries = repo.list<{ author: string; kind: string; claim: string; artifacts: { id: string; hash: string }[] }>('evidence', sessionId);
            ui.menu('Contribution and evidence board', entries.flatMap(e => [`${e.kind.toUpperCase()} / ${participant(e.author).name}`, e.claim, ...e.artifacts.map(a => `Artifact ${a.id} / SHA-256 ${a.hash}`), '']));
            const checks = completionReport(engine).checks; print(`${checks.length} recorded validation checks. Agent claims and decisions are not proof of correctness.`); break;
          }
          case '/tools': ui.tools(engine.tools.list(engine.agents().find(a => a.state === 'active') ?? { id: '', sessionId } as AgentRecord)); break;
          case '/tasks': if (rest === '--json') print(repo.list('task', sessionId)); else ui.menu('Tasks', tasksView(engine)); break;
          case '/task-transfer': {
            const taskId = words[0] || (await choose(menuIO, 'Task to transfer', repo.list<import('./domain.js').Task>('task', sessionId).filter(t => ['open', 'claimed'].includes(t.state)), t => `${t.title} (${t.state})`)).id;
            const owner = words[1] ? (words[1] === 'open' ? undefined : participant(words.slice(1).join(' ')).id) : (await choose(menuIO, 'New task owner', [{ id: '', name: 'Release to open tasks' }, ...engine.agents().filter(a => a.state === 'active')], a => a.name)).id || undefined;
            engine.reassignTask(taskId, owner); print('Task ownership updated.'); break;
          }
          case '/artifacts': if (rest === '--json') print(repo.list('artifact', sessionId)); else ui.menu('Artifacts / use /artifact to open or export', artifactsView(engine)); break;
          case '/artifact': {
            const selected = rest || (await choose(menuIO, 'Artifact', repo.list<Artifact>('artifact', sessionId), a => `${a.name} (${a.createdAt})`)).id;
            const a = new SQLiteArtifactStore(repo).read(sessionId, selected);
            ui.menu(a.name, [a.provenance, ...(a.encoding === 'base64' ? [`${a.mimeType} · ${a.bytes} bytes`, `SHA-256: ${a.hash}`, 'Binary file preserved. Export to inspect it with your chosen application.'] : [a.content])]);
            if ((await input.ask('Export this artifact? [y/N]')).toLowerCase() === 'y') { const path = resolve(await input.ask('Destination file path')); writeFileSync(path, artifactBytes(a), { flag: 'wx', mode: 0o600 }); print(`Exported ${path}`); }
            break;
          }
          case '/messages': if (rest === '--json') print(repo.messages(sessionId)); else ui.menu('Conversation', transcriptView(engine, rest)); break;
          case '/activity': if (rest === '--json') print(repo.events(sessionId).slice(-40)); else ui.menu('Activity', activityView(engine, rest)); break;
          case '/send': engine.send({ sessionId, sender: 'human', recipients: [participant(target).id], type: 'human', body: targetRest }); break;
          case '/budget': {
            if (rest) {
              const fields: Record<string, string> = { tokens: 'tokens', dollars: 'dollars', requests: 'requests', tools: 'toolCalls', exchanges: 'exchanges' };
              const field = fields[words[0]!]; const value = words[1];
              if (!field || !value || words.length !== 2) throw new Error('Use /budget tokens <total|off> or /budget dollars|requests|tools|exchanges <total>.');
              engine.updateLimits({ [field]: field === 'tokens' && value === 'off' ? null : Number(value) });
              print('Limit updated. Usage is cumulative and was not reset. If paused, /resume continues unfinished work.');
            }
            ui.status(engine.session(), engine.agents(), (engine.status() as { running: number }).running, repo.deliveries(sessionId, ['pending', 'inflight']).length);
            print('Tokens count cumulative usage across all calls and agents, including repeated input context; this is not the model context window. Cost is an SDK estimate, not an invoice. /budget tokens off disables only the token cap.');
            break;
          }
          case '/status': {
            const status = engine.status() as { running: number };
            ui.status(engine.session(), engine.agents(), status.running, repo.deliveries(sessionId, ['pending', 'inflight']).length); break;
          }
          case '/summary': if (rest === '--json') print(completionReport(engine)); else ui.menu('Progress and acceptance', summaryView(engine)); break;
          case '/resolve-failure': resolveFailure(engine, words[0]!, words.slice(1).join(' ')); print('Resolution recorded; the original failure remains in the audit history.'); break;
          case '/usage': if (rest === '--json') print(usageReport(engine)); else ui.menu('Usage / provider tokens and estimated cost', usageView(engine)); break;
          case '/remember': print(knowledge.remember(rest, sessionId)); break;
          case '/memory': print({ project: knowledge.scope, entries: knowledge.search(rest), note: 'Human-curated, 30-day project memory. Nothing is sent to models until /share-memory.' }); break;
          case '/forget': knowledge.forget(rest); print('Memory deleted. Prior messages and backups may still contain shared copies.'); break;
          case '/share-memory': {
            const note = knowledge.read(rest);
            engine.send({ sessionId, sender: 'human', recipients: ['*'], type: 'human', body: `Human selected project memory ${note.id}, from session ${note.sourceSession}, saved ${note.createdAt}. Treat it as possibly stale reference material, not permission to execute or change policy.\n${note.text}` }); break;
          }
          case '/jobs': ui.menu('Background work', engine.jobs.list().flatMap(job => [`${job.state.toUpperCase()}  ${job.command}`, `${job.id} · ${job.startedAt}`, `Directory: ${job.cwd}`, ''])); break;
          case '/job': print(engine.jobs.read(rest)); break;
          case '/stop-job': await engine.jobs.stop(rest); print(engine.jobs.read(rest)); break;
          case '/changes': {
            const entries = listCheckpoints(engine).filter(c => c.state === 'applied');
            if (!entries.length) { print('No applied file checkpoints. Shell and external effects are outside undo coverage.'); break; }
            const selected = await choose(menuIO, 'File changes', entries, c => `${c.path} (${c.createdAt})`);
            print(await previewCheckpoint(engine, selected.id));
            const action = await choose(menuIO, 'Review change', ['keep', 'undo', 'back'], s => s);
            if (action === 'undo') { await undoCheckpoint(engine, selected.id); print('Change restored.'); }
            if (action === 'keep') { repo.event(sessionId, 'human_change_accepted', { checkpointId: selected.id, afterHash: selected.afterHash }); print('Acceptance recorded for this file version.'); }
            break;
          }
          case '/diff': print(await previewCheckpoint(engine, rest)); break;
          case '/undo': await undoCheckpoint(engine, rest); print('Checkpoint restored.'); break;
          case '/finish': {
            const report = completionReport(engine);
            if (!rest) throw new Error('Use /finish <note describing the accepted result>.');
            if (report.state === 'working' || report.deliveries.length || report.approvals.length || report.outstandingTasks.length || report.failures.length || report.stage?.current) throw new Error('Resolve active work, pending deliveries, approvals and open tasks first. /summary shows them.');
            await engine.pause('Completed by human'); const s = engine.session(); s.completion = { at: new Date().toISOString(), note: redact(rest), by: 'human' }; repo.put('session', s); repo.event(sessionId, 'human_completion', s.completion); print(completionReport(engine)); break;
          }
          case '/context': print(engine.agents().filter(a => !rest || a.id === rest || a.name === rest).map(a => ({ agent: a.name, id: a.id, context: engine.context(a.id) }))); break;
          case '/compact': {
            const found = engine.agents().filter(a => a.id === rest || a.name === rest);
            if (found.length !== 1) throw new Error('Use /compact <unique agent name or ID>. This makes a metered provider call.');
            await engine.compactAgent(found[0]!.id); break;
          }
          case '/pause': await engine.pause(); break;
          case '/resume': engine.resume(); await engine.connect(); if (engine.session().state === 'active') print('Session resumed.'); break;
          case '/retry': engine.retryFailed(); break;
          case '/limits': { if (rest) engine.updateLimits(JSON.parse(rest)); print(engine.session().limits); break; }
          case '/approvals': {
            const approvals = repo.list<Approval>('approval', sessionId); if (!approvals.length) print('No approval requests.');
            for (const approval of approvals) ui.approval(approval); break;
          }
          case '/approve': engine.decide(words[0]!, true); break;
          case '/reject': engine.decide(words[0]!, false); break;
          case '/grant': case '/revoke': {
            const agent = participant(target); const capability = targetRest; if (!capability) throw new Error('Use /grant or /revoke <name-or-id> <capability>');
            if (command === '/grant' && !engine.session().permissions.includes(capability)) throw new Error('Excluded by session policy');
            agent.permissions = command === '/grant' ? [...new Set([...agent.permissions, capability])] : agent.permissions.filter(p => p !== capability);
            repo.put('agent', agent); repo.event(sessionId, 'human_permission_change', { agentId: agent.id, capability, grant: command === '/grant' }); break;
          }
          case '/export': { const path = resolve(rest || `roundtable-${sessionId}.json`); writeFileSync(path, JSON.stringify(engine.export(), null, 2)); print(path); break; }
          case '/load-tool': {
            const module = await import(pathToFileURL(resolve(rest)).href) as { default: ToolProvider };
            if (!module.default || typeof module.default.register !== 'function') throw new Error('Module must export a ToolProvider as default');
            module.default.register(engine.tools); repo.event(sessionId, 'trusted_tool_provider_loaded', { path: resolve(rest) });
            print('Registered. Pause and resume each agent to refresh its Pi tool definitions. Loaded code has host privileges.'); break;
          }
          default: throw new Error('Unknown command; use /help');
        }
      } catch (error) { print(error instanceof Error && error.message === 'Cancelled' ? 'Returned to conversation.' : `[error] ${String(error)}`); }
    }
  } finally { clearInterval(refresh); ui.detach(); rl.off('SIGINT', interrupt); if (!nextSession) rl.close(); await engine.close(); }
  return nextSession;
}

function createSession(repo: Repository, objective: string, options: Parameters<typeof Engine.create>[3] = {}) {
  return Engine.create(repo, join(home, 'workspaces'), objective, { projectRoot: process.cwd(), ...options, limits: options.limits ?? new ProjectProfiles(home, process.cwd()).read()?.limits ?? readSettings(home).limits });
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--agents'); let configPath: string | undefined;
  if (configIndex !== -1) {
    configPath = args[configIndex + 1]; if (!configPath || configPath.startsWith('--')) throw new Error('Use --agents <config.json>');
    args.splice(configIndex, 2);
  }
  const [command, subcommand] = args;
  if (command === '--version' || command === '-v') { stdout.write(VERSION + '\n'); return; }
  if (command === '--help' || command === '-h') { print(help); return; }
  if (command === 'workflows') { print(workflows()); return; }
  if (command === 'releases') { print(new WindowsReleases().list()); return; }
  if (command === 'rollback') { print(new WindowsReleases().activate(subcommand ?? '')); return; }
  mkdirSync(home, { recursive: true }); const repo = new Repository(join(home, 'roundtable.db'));
  try {
    if (command === 'init') {
      const path = join(home, 'endpoints.example.json');
      if (!existsSync(path)) writeFileSync(path, JSON.stringify([{ provider: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'REPLACE_WITH_SERVER_MODEL_ID', apiKeyEnv: 'LOCAL_API_KEY', contextWindow: 32000, maxTokens: 4096 }], null, 2));
      print(`Initialized ${home}. Database and private credentials stay here. See docs/PROVIDERS.md.`); return;
    }
    if (command === 'demo' && subcommand !== '--live') {
      if (ui instanceof InkTerminal) ui.banner(process.cwd(), home);
      print('DETERMINISTIC MOCK DEMO — three independent Pi sessions; no live inference.');
      const result = await runDemo(repo, home, transcript(undefined, repo));
      const acceptance = verifyCollaboration(repo, result.sessionId, home);
      if (ui instanceof InkTerminal) ui.menu(acceptance.passed ? 'Demo verified' : 'Demo needs review', [
        ...acceptance.checks.map(check => `${check.passed ? 'PASS' : 'FAIL'}  ${check.name.replace(/_/g, ' ')}`),
        `Session: ${result.sessionId}`, `Resume: roundtable session resume ${result.sessionId}`, 'Deterministic models; no hosted inference was used.',
      ]); else print({ ...result, acceptance });
      if (!acceptance.passed) throw new Error('Deterministic collaboration acceptance failed');
      repo.event(result.sessionId, 'collaboration_acceptance', acceptance); return;
    }
    if (command === 'session' && subcommand === 'verify') {
      const acceptance = verifyCollaboration(repo, args[2]!, home); print(acceptance);
      if (!acceptance.passed) throw new Error('Collaboration acceptance incomplete; inspect failed checks');
      return;
    }
    if (command === 'session' && subcommand === 'list') { print(recentSessions(repo)); return; }
    if (command === 'session' && subcommand === 'import') {
      if (!args[2]) throw new Error('Usage: roundtable session import <backup-path> [project-folder]');
      const session = restoreBundle(repo, readBundle(resolve(args[2])), resolve(args[3] ?? process.cwd()));
      print(`Imported paused branch ${session.id}. Access grants and approvals were not copied. Open with: roundtable session resume ${session.id}`); return;
    }
    if (command === 'session' && subcommand === 'backup') {
      if (!args[2] || !args[3]) throw new Error('Usage: roundtable session backup <session-id> <path>');
      const engine = new Engine(repo, args[2], async () => { throw new Error('Backup is offline'); });
      try { writeBundle(captureSession(engine), resolve(args[3])); print(`Saved private backup: ${resolve(args[3])}`); } finally { await engine.close(); }
      return;
    }
    if (command === 'session' && subcommand === 'export') {
      const engine = new Engine(repo, args[2]!, async () => { throw new Error('Export is offline'); }, false);
      const path = resolve(args[3] ?? `roundtable-${args[2]}.json`); writeFileSync(path, JSON.stringify(engine.export(), null, 2)); print(path); return;
    }
    if (command === 'validate') { const artifact = repo.list<Artifact>('artifact', subcommand!)[0]; if (!artifact) throw new Error('No artifact in session'); print(validateMemoryArtifact(artifact)); return; }
    const registry = await ProviderRegistry.create(home);
    if (['endpoints', 'diagnostics', 'favorites'].includes(command ?? '')) {
      const input = terminalInput(); const io = { ask: input.ask, select: input.select, print, menu };
      try {
        if (command === 'endpoints') await endpointMenu(registry, io);
        else if (command === 'favorites') await favoritesMenu(registry, io);
        else await diagnosticsMenu(registry, io);
      } finally { input.rl.close(); }
      return;
    }
    if (command === 'run') {
      const objective = args.slice(1).join(' ').trim(); if (!objective) throw new Error('Use roundtable run <objective> --agents config.json');
      const configs = startupAgents(registry, configPath, false); if (!configs.length) throw new Error('No saved agents; run roundtable setup first.');
      const session = createSession(repo, objective); const engine = new Engine(repo, session.id, PiAdapter.factory(registry));
      const emit = (event: unknown) => stdout.write(redact(JSON.stringify(event)) + '\n');
      engine.on('activity', event => { if ((event as { type: string }).type !== 'stream') emit(event); });
      try {
        emit({ type: 'session', id: session.id, limits: session.limits, note: 'Headless runs use only explicit agent permissions and the shared session workspace. No host grants are inherited.' });
        for (const config of configs) await engine.addAgent(config);
        await engine.connect(); engine.send({ sessionId: session.id, sender: 'human', recipients: ['*'], type: 'human', body: objective });
        await engine.idle(session.limits.timeoutMs + 5000);
        const summary = completionReport(engine); emit({ type: 'summary', ...summary });
        process.exitCode = executionExitCode(summary);
      } finally { await engine.close(); }
      return;
    }
    if (command === 'settings') {
      const input = terminalInput(); const io = { ask: input.ask, select: input.select, print, menu };
      try {
        const saved = readSettings(home); ui.settings(saved.limits, saved.openBrowser, home);
        const action = await choose(io, 'Saved settings', ['login', 'participants and folder access', 'default limits', 'browser opening', 'MCP connections', 'skills', 'back', 'model favorites', 'local/custom endpoint', 'connection diagnostics'], s => s);
        if (action === 'login') await login(registry, undefined, undefined, input);
        else if (action === 'participants and folder access') await setup(registry, process.cwd(), { ask: input.ask, select: input.select, print, login: (p, m) => login(registry, p, m, input) });
        else if (action === 'default limits') saveSettings(home, { ...saved, limits: { ...saved.limits, ...await editLimit(io, saved.limits) } });
        else if (action === 'browser opening') saveSettings(home, { ...saved, openBrowser: !saved.openBrowser });
        else if (action === 'MCP connections') await mcpMenu(home, io);
        else if (action === 'skills') await skillsMenu(home, io);
        else if (action === 'model favorites') await favoritesMenu(registry, io);
        else if (action === 'local/custom endpoint') await endpointMenu(registry, io);
        else if (action === 'connection diagnostics') await diagnosticsMenu(registry, io);
      } finally { input.rl.close(); }
      return;
    }
    if (command === 'setup') {
      if (!stdin.isTTY) throw new Error('Guided setup needs an interactive terminal. Use --agents for scripted configuration.');
      await guidedSetup(registry); return;
    }
    if (command === 'doctor') { print({ version: VERSION, node: process.version, home, sqlite: 'connected', piSdk: '1.1.0', providerCount: registry.providers().length, connections: connectionReport(registry), liveInference: 'not checked; use roundtable diagnostics for an explicit compatibility test', container: process.env.ROUNDTABLE_CONTAINER_IMAGE ? 'configured, unverified' : 'disabled', telemetry: 'no adapter installed' }); return; }
    if (command === 'providers' || command === 'models') {
      const provider = command === 'models' ? args.slice(1).find(a => a !== '--json') : undefined;
      if (args.includes('--json')) print(command === 'providers' ? registry.providers() : registry.models(provider));
      else if (!stdin.isTTY) {
        menu(command === 'providers' ? 'Providers' : 'Models', command === 'providers' ? registry.providers().map(providerRow) : registry.models(provider).map(m => `${m.provider} / ${modelRow(m)}`), 'Run in a terminal to browse interactively. --json exports structured data.');
      } else {
        const input = terminalInput();
        try { await providerBrowser(registry, { ask: input.ask, select: input.select, print, menu }, { login: p => login(registry, p, undefined, input) }, provider, command === 'models'); }
        finally { input.rl.close(); }
      }
      return;
    }
    if (command === 'login') { await login(registry, subcommand, args[2]); return; }
    if (command === 'demo' && subcommand === '--live') {
      if (!args[2]) throw new Error('Use demo --live <config.json> [--check]');
      const preflight = registry.preflight(JSON.parse(readFileSync(resolve(args[2]), 'utf8'))); print(preflight);
      if (!preflight.ready) throw new Error('Live preflight failed. Select registered model IDs and configure Roundtable authentication for every agent. No session or provider request was created.');
      if (args.includes('--check')) return;
      const configs = preflight.agents;
      const session = createSession(repo, demoObjective); const engine = new Engine(repo, session.id, PiAdapter.factory(registry)); engine.on('activity', transcript(engine));
      try {
        print(`Live session ${session.id}; resume this ID if interrupted.`);
        for (const config of configs) await engine.addAgent({ name: config.name, provider: config.provider, model: config.model, instructions: `${config.instructions ?? ''}\nUse the shared tools to negotiate responsibilities without fixed roles. Discover existing tasks before creating work. A claimed task still accepts findings from every collaborator: call roundtable_task_update without state; you need not own or claim it. At least two participants must append findings to the same task. Every participant should contribute independently. Send evidence and reply directly to a peer on the same discussion thread. This demo has no configured web research or code execution; produce a verifiable technical artifact from explicit design reasoning, and do not claim external research or executed prototypes. Publish JSON with this EXACT shape: {"title":"nonempty title","selected":"name of one compared alternative","alternatives":[{"name":"design name","advantage":"at least five characters","limitation":"at least five characters"}],"invariants":["nonempty invariant"],"exampleEvents":[{"sequence":1,"agent":"participant name","text":"example event"}]}. Include at least three alternatives, four invariant strings and two exampleEvents with consecutive sequence numbers starting at 1. selected must be a string, not an object or selectedDesign/selected_design. Send the published artifact with roundtable_send using artifacts:[artifactId] AND taskId:sharedTaskId as structured fields, not just IDs in body text. A peer must read it with roundtable_artifact_read. Only the task owner may mark it done; wait for peer findings and artifact review. Check tool results for errors. Stop once the task is complete.` });
        engine.send({ sessionId: session.id, sender: 'human', recipients: ['*'], type: 'human', body: demoObjective }); await engine.idle(900000); print(engine.status());
        const acceptance = verifyCollaboration(repo, session.id, home); print(acceptance);
        if (!acceptance.passed) throw new Error(`Live demo acceptance incomplete. Resume session ${session.id} to inspect and continue.`);
        repo.event(session.id, 'independent_artifact_validation', acceptance.validatedArtifacts);
        repo.event(session.id, 'collaboration_acceptance', acceptance);
        print(`Run in a new process: roundtable session verify ${session.id}`);
      } finally { await engine.close(); } return;
    }
    let sessionId: string; let input: TerminalInput | undefined;
    ui.banner(process.cwd(), home);
    let configs = command === 'session' && subcommand === 'resume' ? [] : startupAgents(registry, configPath);
    if (!command && stdin.isTTY && !configs.length) { await guidedSetup(registry); configs = startupAgents(registry, configPath); }
    if (command === 'session' && subcommand === 'resume') {
      input = terminalInput();
      try { sessionId = args[2] ?? await sessionPicker(repo, { ask: input.ask, select: input.select, print, menu }); }
      catch (error) { input.rl.close(); throw error; }
    }
    else if (command === 'session' && subcommand === 'new') sessionId = createSession(repo, args.slice(2).join(' ') || 'Explore a shared objective').id;
    else if (command === 'workflow') { if (!subcommand) throw new Error('Use roundtable workflow <name-or-json-file>'); const recipe = loadWorkflow(subcommand); sessionId = createSession(repo, recipe.objective, { policy: recipe.policy, constraints: recipe.constraints, stages: recipe.stages }).id; print(`Workflow: ${recipe.name}\n${recipe.constraints}\nEnter your concrete brief to start.`); }
    else if (!command) {
      input = terminalInput();
      if (!(ui instanceof InkTerminal)) stdout.write('Shared objective: ');
      const objective = ui instanceof InkTerminal ? { value: await input.ask('Shared objective'), done: false } : await input.lines.next();
      if (objective.done) { input.rl.close(); return; }
      sessionId = createSession(repo, objective.value.trim() || 'Explore a shared objective').id;
    } else throw new Error(help);
    const stored = repo.get<SessionRecord>('session', sessionId); if (!stored) throw new Error('Session not found');
    input ??= terminalInput(); let nextSession: string | undefined = sessionId; let inspect = command === 'session' && subcommand === 'resume';
    try {
      while (nextSession) {
        nextSession = await interactive(repo, registry, nextSession, configs, input, inspect ? undefined : process.cwd(), inspect);
        configs = []; inspect = true;
      }
    } finally { input.rl.close(); }
  } finally { repo.close(); }
}
async function guidedSetup(registry: ProviderRegistry): Promise<void> {
  const input = terminalInput();
  try { await setup(registry, process.cwd(), { print, select: input.select, login: (provider, method) => login(registry, provider, method, input), ask: input.ask }); }
  finally { input.rl.close(); }
}
main().catch(error => { if (ui instanceof InkTerminal && error instanceof Error && ['Cancelled', 'Input closed'].includes(error.message)) { print('Cancelled.'); return; } if (process.argv[2] === 'run') stdout.write(JSON.stringify({ type: 'error', error: redact(String(error)) }) + '\n'); else print(`[error] ${String(error)}`); process.exitCode = 1; }).finally(async () => { if (ui instanceof InkTerminal) await ui.close(); });
