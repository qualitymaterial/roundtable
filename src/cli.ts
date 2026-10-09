#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
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
import { AgentInput, Limits, type AgentRecord, type Artifact, type SessionRecord } from './domain.js';
import type { ToolProvider } from './tools.js';
import { HostAccess, hostCapabilities, normalizeHostPolicy } from './host-tools.js';
import type { Approval } from './domain.js';
import { TerminalUI } from './terminal-ui.js';

const userHome = join(homedir(), '.roundtable');
const configFile = join(userHome, 'config.json');
const userConfig = !process.env.ROUNDTABLE_HOME && existsSync(configFile) ? z.object({ dataDir: z.string().min(1), projectAccess: z.boolean().default(false) }).strict().parse(JSON.parse(readFileSync(configFile, 'utf8'))) : undefined;
const home = resolve(process.env.ROUNDTABLE_HOME ?? userConfig?.dataDir ?? userHome);
const ui = new TerminalUI(stdout);
const print = (value: unknown) => ui.print(value);
function transcript(engine?: Engine, repo?: Repository): (activity: unknown) => void {
  return activity => {
    const a = activity as { type: string; agentId?: string; name?: string; result?: unknown; error?: string; text?: string; message?: { sender: string; body: string; recipients: string[] } };
    const agentId = a.agentId ?? a.message?.sender ?? '';
    const agent = engine?.agents().find(x => x.id === agentId) ?? repo?.get<AgentRecord>('agent', agentId);
    const label = agent ? `${agent.name} [${agent.provider}/${agent.model}]` : (a.agentId ?? a.message?.sender ?? 'system');
    if (a.type === 'stream') { ui.composing(label); return; }
    if (a.type === 'message') {
      const recipients = stdout.isTTY ? a.message!.recipients.map(id => engine?.agents().find(x => x.id === id)?.name ?? id) : a.message!.recipients;
      ui.message(label, a.message!.body, recipients, a.message!.sender === 'human');
    }
    else if (a.type === 'tool') ui.tool(label, a.name!);
    else if (a.type === 'tool_result') ui.tool(label, a.name!, a.result);
    else if (a.type === 'approval' && engine && stdout.isTTY) {
      const pending = engine.repo.list<Approval>('approval', engine.sessionId).filter(x => x.state === 'pending').at(-1);
      if (pending) ui.approval(pending);
    }
    else print(`[${a.type}] ${label}: ${a.error ?? a.text ?? ''}`);
  };
}
const help = `Roundtable — independent agents, shared objectives
roundtable [--agents config.json]   Start with saved agents; live admission uses provider requests
roundtable init | doctor | providers | models [provider] | login <provider> [oauth|api_key]
roundtable session new <objective> [--agents config.json]
roundtable session list | resume <id> | export <id> [path]
roundtable demo                 Deterministic model fixtures using three real Pi sessions
roundtable demo --live config.json  Three configured live providers; may incur provider charges
roundtable demo --live config.json --check  Local configuration preflight; no inference
roundtable validate <session-id>    Independently validate the memory demo artifact
roundtable session verify <id>     Check persisted collaboration acceptance without inference

Interactive commands:
/agents | /add-agent <JSON> | /remove-agent <id> | /pause-agent <id> | /resume-agent <id>
/replace-agent <id> <provider> <model>
/providers | /models [provider] | /tools | /tasks | /artifacts | /messages | /activity
/send <agent-id> <message> | ordinary text broadcasts to all members
/status | /pause | /resume | /retry | /limits <JSON>
/approvals | /approve <request-id> | /reject <request-id>
/host | /host-read <absolute-folder> | /host-write <absolute-folder>
/host-shell on|off | /host-off | /save-access
/grant <agent-id> <capability> | /revoke <agent-id> <capability>
/export [path] | /save-agents | /load-tool <trusted-module-path> | /help | /exit
Example /add-agent {"name":"My agent","provider":"openrouter","model":"ID from /models","instructions":"Choose your own approach"}`;

async function login(registry: ProviderRegistry, provider: string, type: string): Promise<void> {
  if (!provider || !['oauth', 'api_key'].includes(type)) throw new Error('Use login <provider> [oauth|api_key]');
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    await registry.login(provider, type as 'oauth' | 'api_key', {
      prompt: async prompt => {
        if (prompt.type === 'secret') {
          if (!stdin.isTTY) throw new Error('Secret login requires an interactive terminal; use a provider environment variable in headless mode');
          rl.pause(); const value = await secretInput(prompt.message); rl.resume(); return value;
        }
        if (prompt.type === 'select') print(prompt.options.map(o => `${o.id}: ${o.label}`).join('\n'));
        return rl.question(`${prompt.message}: `, { signal: prompt.signal });
      },
      notify: event => print(event),
    }); print('Authentication stored in Roundtable’s own auth.json.');
  } finally { rl.close(); }
}
async function secretInput(label: string): Promise<string> {
  stdout.write(`${label}: `); const previous = stdin.isRaw; stdin.setRawMode(true); stdin.resume();
  return new Promise((resolveInput, reject) => {
    let value = '';
    const cleanup = () => { stdin.off('data', handler); stdin.setRawMode(previous); stdout.write('\n'); };
    const handler = (buffer: Buffer) => {
      for (const char of buffer.toString()) {
        if (char === '\r' || char === '\n') { cleanup(); resolveInput(value); return; }
        if (char === '\u0003') { cleanup(); reject(new Error('Login cancelled')); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1); else if (char >= ' ') value += char;
      }
    }; stdin.on('data', handler);
  });
}
type TerminalInput = { rl: ReturnType<typeof createInterface>; lines: AsyncIterableIterator<string> };
function terminalInput(): TerminalInput {
  const commands = [...new Set(help.match(/\/[a-z-]+/g))];
  const rl = createInterface({ input: stdin, output: stdout, completer: line => [commands.filter(command => command.startsWith(line)), line] });
  return { rl, lines: rl[Symbol.asyncIterator]() };
}
function startupAgents(registry: ProviderRegistry, explicitPath?: string): z.output<typeof AgentInput>[] {
  const path = explicitPath ? resolve(explicitPath) : [join(home, 'agents.json'), join(home, 'live-agents.json')].find(existsSync);
  if (!path) return [];
  const configs = z.array(AgentInput.strict()).min(1).max(64).parse(JSON.parse(readFileSync(path, 'utf8')));
  for (const config of configs) {
    registry.model(config.provider, config.model);
    if (!registry.providers().some(p => p.id === config.provider && p.configured)) throw new Error(`No Roundtable authentication for ${config.provider}; run login ${config.provider} api_key or configure its supported environment variable`);
  }
  print(`Loading ${configs.length} agents from ${path}. Admission makes two provider requests per agent; provider charges or quotas may apply.`);
  return configs;
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
async function interactive(repo: Repository, registry: ProviderRegistry, sessionId: string, configs: z.output<typeof AgentInput>[] = [], input = terminalInput(), projectFolder?: string): Promise<void> {
  await registerMock(registry);
  const engine = new Engine(repo, sessionId, async (agent, current) => PiAdapter.create(registry, agent, current, agent.provider === 'roundtable-mock' ? mockStream : undefined));
  const { rl, lines } = input;
  ui.attach(rl);
  engine.on('activity', transcript(engine));
  try {
    ui.banner(projectFolder ?? process.cwd(), home); ui.session(engine.session());
    const accessPath = join(home, 'host-access.json');
    if (!engine.session().hostAccess && existsSync(accessPath)) await configureHost(engine, JSON.parse(readFileSync(accessPath, 'utf8')), true);
    if (projectFolder && userConfig?.projectAccess) {
      const policy = HostAccess.parse(engine.session().hostAccess ?? {}); policy.writeRoots.push(projectFolder); await configureHost(engine, policy, true);
    }
    ui.host(HostAccess.parse(engine.session().hostAccess ?? {}));
    if (engine.session().hostAccess?.shell) print('Host shell requires approval for each exact command. It runs with your OS user privileges; it is not sandboxed.');
    const withHostPermissions = (config: z.input<typeof AgentInput>) => ({ ...config, permissions: [...new Set([...(config.permissions ?? ['collaborate', 'memory', 'artifact']), ...hostCapabilities(HostAccess.parse(engine.session().hostAccess ?? {}))])] });
    for (const config of configs) {
      print(`[connecting] ${config.name} [${config.provider}/${config.model}]`);
      try { await engine.addAgent(withHostPermissions(config)); }
      catch (error) { print(`[error] ${config.name}: ${String(error)}`); }
    }
    await engine.connect();
    const active = engine.agents().filter(a => a.state === 'active');
    for (const agent of active) print(`[connected] ${agent.name} [${agent.provider}/${agent.model}]`);
    if (stdout.isTTY) ui.agents(active);
    print(active.length ? `${active.length} agents ready. Type a message to talk to them, or /help for commands.` : 'No agents connected. Use /add-agent <JSON> or save a model configuration to .roundtable/agents.json and restart. /help shows an example.');
    while (true) {
      ui.prompt(); const next = await lines.next(); ui.submitted(); if (next.done) break;
      const line = next.value.trim(); if (!line) continue;
      const [command, ...words] = line.split(/\s+/); const rest = line.slice(command!.length).trim();
      try {
        if (command === '/exit') break;
        if (!line.startsWith('/')) {
          if (!engine.agents().some(a => a.state === 'active')) throw new Error('No agents connected; message was not sent. Use /add-agent or restart with --agents config.json.');
          engine.send({ sessionId, sender: 'human', recipients: ['*'], type: 'human', body: line }); continue;
        }
        switch (command) {
          case '/help': print(help); break;
          case '/agents': ui.agents(engine.agents()); break;
          case '/add-agent': print(await engine.addAgent(withHostPermissions(AgentInput.parse(JSON.parse(rest))))); break;
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
            const configs = engine.agents().filter(a => a.state !== 'removed').map(({ name, provider, model, instructions, permissions }) => ({ name, provider, model, instructions, permissions }));
            if (!configs.length) throw new Error('No agents to save');
            const path = join(home, 'agents.json'); writeFileSync(path, JSON.stringify(configs, null, 2)); print(`Saved ${configs.length} agents to ${path} for future sessions.`); break;
          }
          case '/remove-agent': await engine.setAgentState(words[0]!, 'removed'); break;
          case '/pause-agent': await engine.setAgentState(words[0]!, 'paused'); break;
          case '/resume-agent': await engine.setAgentState(words[0]!, 'active'); break;
          case '/replace-agent': {
            const old = engine.agents().find(a => a.id === words[0]); if (!old) throw new Error('Unknown agent');
            await engine.setAgentState(old.id, 'removed');
            print(await engine.addAgent({ name: old.name, provider: words[1]!, model: words[2]!, instructions: old.instructions, permissions: old.permissions })); break;
          }
          case '/providers': print(registry.providers()); break;
          case '/models': print(registry.models(words[0])); break;
          case '/tools': ui.tools(engine.tools.list(engine.agents().find(a => a.state === 'active') ?? { id: '', sessionId } as AgentRecord)); break;
          case '/tasks': print(repo.list('task', sessionId)); break;
          case '/artifacts': print(repo.list('artifact', sessionId)); break;
          case '/messages': print(repo.messages(sessionId)); break;
          case '/activity': print(repo.events(sessionId).slice(-40)); break;
          case '/send': engine.send({ sessionId, sender: 'human', recipients: [words[0]!], type: 'human', body: rest.slice(words[0]!.length).trim() }); break;
          case '/status': {
            const status = engine.status() as { running: number };
            ui.status(engine.session(), engine.agents(), status.running, repo.deliveries(sessionId, ['pending', 'inflight']).length); break;
          }
          case '/pause': await engine.pause(); break;
          case '/resume': engine.resume(); break;
          case '/retry': engine.retryFailed(); break;
          case '/limits': { const s = engine.session(); s.limits = Limits.parse({ ...s.limits, ...JSON.parse(rest) as object }); repo.put('session', s); repo.event(sessionId, 'limits_changed', s.limits); print(s.limits); break; }
          case '/approvals': {
            const approvals = repo.list<Approval>('approval', sessionId); if (!approvals.length) print('No approval requests.');
            for (const approval of approvals) ui.approval(approval); break;
          }
          case '/approve': {
            engine.decide(words[0]!, true); const approval = repo.get<Approval>('approval', words[0]!);
            if (approval?.command) engine.send({ sessionId, sender: 'human', recipients: [approval.agentId], type: 'human', body: `I approved this exact host command once. Retry host_execute with ${JSON.stringify({ command: approval.command.text, cwd: approval.command.cwd })}.` });
            break;
          }
          case '/reject': engine.decide(words[0]!, false); break;
          case '/grant': case '/revoke': {
            const agent = engine.agents().find(a => a.id === words[0]); const capability = words[1]; if (!agent || !capability) throw new Error('Use /grant or /revoke <agent-id> <capability>');
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
      } catch (error) { print(`[error] ${String(error)}`); }
    }
  } finally { ui.detach(); rl.close(); await engine.close(); }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--agents'); let configPath: string | undefined;
  if (configIndex !== -1) {
    configPath = args[configIndex + 1]; if (!configPath || configPath.startsWith('--')) throw new Error('Use --agents <config.json>');
    args.splice(configIndex, 2);
  }
  const [command, subcommand] = args;
  if (command === '--help' || command === '-h') { print(help); return; }
  mkdirSync(home, { recursive: true }); const repo = new Repository(join(home, 'roundtable.db'));
  try {
    if (command === 'init') {
      const path = join(home, 'endpoints.example.json');
      if (!existsSync(path)) writeFileSync(path, JSON.stringify([{ provider: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'REPLACE_WITH_SERVER_MODEL_ID', apiKeyEnv: 'LOCAL_API_KEY', contextWindow: 32000, maxTokens: 4096 }], null, 2));
      print(`Initialized ${home}. Database and private credentials stay here. See docs/PROVIDERS.md.`); return;
    }
    if (command === 'demo' && subcommand !== '--live') {
      print('DETERMINISTIC MOCK DEMO — three independent Pi sessions; no live inference.');
      const result = await runDemo(repo, home, transcript(undefined, repo));
      const acceptance = verifyCollaboration(repo, result.sessionId, home); print({ ...result, acceptance });
      if (!acceptance.passed) throw new Error('Deterministic collaboration acceptance failed');
      repo.event(result.sessionId, 'collaboration_acceptance', acceptance); return;
    }
    if (command === 'session' && subcommand === 'verify') {
      const acceptance = verifyCollaboration(repo, args[2]!, home); print(acceptance);
      if (!acceptance.passed) throw new Error('Collaboration acceptance incomplete; inspect failed checks');
      return;
    }
    if (command === 'session' && subcommand === 'list') { print(repo.list('session')); return; }
    if (command === 'session' && subcommand === 'export') {
      const engine = new Engine(repo, args[2]!, async () => { throw new Error('Export is offline'); }, false);
      const path = resolve(args[3] ?? `roundtable-${args[2]}.json`); writeFileSync(path, JSON.stringify(engine.export(), null, 2)); print(path); return;
    }
    if (command === 'validate') { const artifact = repo.list<Artifact>('artifact', subcommand!)[0]; if (!artifact) throw new Error('No artifact in session'); print(validateMemoryArtifact(artifact)); return; }
    const registry = await ProviderRegistry.create(home);
    if (command === 'doctor') { print({ node: process.version, home, sqlite: 'connected', piSdk: '1.1.0', providerCount: registry.providers().length, liveInference: 'not checked; add an agent to run a compatibility probe', container: process.env.ROUNDTABLE_CONTAINER_IMAGE ? 'configured, unverified' : 'disabled', telemetry: 'no adapter installed' }); return; }
    if (command === 'providers') { print(registry.providers()); return; }
    if (command === 'models') { print(registry.models(subcommand)); return; }
    if (command === 'login') { await login(registry, subcommand!, args[2] ?? 'oauth'); return; }
    if (command === 'demo' && subcommand === '--live') {
      if (!args[2]) throw new Error('Use demo --live <config.json> [--check]');
      const preflight = registry.preflight(JSON.parse(readFileSync(resolve(args[2]), 'utf8'))); print(preflight);
      if (!preflight.ready) throw new Error('Live preflight failed. Select registered model IDs and configure Roundtable authentication for every agent. No session or provider request was created.');
      if (args.includes('--check')) return;
      const configs = preflight.agents;
      const session = Engine.create(repo, join(home, 'workspaces'), demoObjective); const engine = new Engine(repo, session.id, PiAdapter.factory(registry)); engine.on('activity', transcript(engine));
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
    const configs = command === 'session' && subcommand === 'resume' ? [] : startupAgents(registry, configPath);
    if (command === 'session' && subcommand === 'resume') sessionId = args[2]!;
    else if (command === 'session' && subcommand === 'new') sessionId = Engine.create(repo, join(home, 'workspaces'), args.slice(2).join(' ') || 'Explore a shared objective').id;
    else if (!command) {
      input = terminalInput(); stdout.write('Shared objective: ');
      const objective = await input.lines.next();
      if (objective.done) { input.rl.close(); return; }
      sessionId = Engine.create(repo, join(home, 'workspaces'), objective.value.trim() || 'Explore a shared objective').id;
    } else throw new Error(help);
    const stored = repo.get<SessionRecord>('session', sessionId); if (!stored) throw new Error('Session not found');
    await interactive(repo, registry, sessionId, configs, input, command === 'session' && subcommand === 'resume' ? undefined : process.cwd());
  } finally { repo.close(); }
}
main().catch(error => { print(`[error] ${String(error)}`); process.exitCode = 1; });
