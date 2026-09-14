// Host de terminais (daemon). Roda como processo detached via electron-as-node.
// Segura os processos pty vivos mesmo quando o app Electron fecha.
// Comunicacao: named pipe, mensagens JSON delimitadas por '\n'.
const net = require('net');
const fs = require('fs');
const os = require('os');

const PIPE = process.argv[2];
const LOG = process.argv[3];

function log(msg) {
  try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

let pty;
try {
  pty = require('node-pty');
} catch (e) {
  log('FALHA ao carregar node-pty: ' + e.message);
  process.exit(1);
}

// Resolve qual executavel de shell usar conforme a escolha do repo
function resolveShell(key) {
  switch (key) {
    case 'cmd':
      return { file: 'cmd.exe', args: [] };
    case 'gitbash': {
      const candidates = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      ];
      const found = candidates.find((p) => fs.existsSync(p));
      return { file: found || 'bash.exe', args: ['-i', '-l'] };
    }
    case 'wsl':
      return { file: 'wsl.exe', args: [] };
    case 'powershell':
    default:
      return { file: 'powershell.exe', args: [] };
  }
}

const terminals = new Map(); // id -> { pty, repoId, name, cwd, buffer }
const clients = new Set();
const MAX_BUFFER = 200000; // caracteres de scrollback guardados por terminal

function send(sock, obj) {
  try { sock.write(JSON.stringify(obj) + '\n'); } catch {}
}

function broadcast(obj) {
  const line = JSON.stringify(obj) + '\n';
  for (const sock of clients) {
    try { sock.write(line); } catch {}
  }
}

function maybeExit() {
  if (clients.size === 0 && terminals.size === 0) {
    log('Sem clientes e sem terminais — encerrando daemon.');
    process.exit(0);
  }
}

function createTerminal({ id, repoId, repoName, name, cwd, cols, rows, shell, initCommand }) {
  if (terminals.has(id)) return;
  const safeCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const sh = resolveShell(shell);
  const term = pty.spawn(sh.file, sh.args, {
    name: 'xterm-color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: safeCwd,
    env: process.env,
  });
  const rec = { pty: term, repoId, repoName: repoName || '', name: name || '', cwd: safeCwd, buffer: '' };

  // Comando automatico ao abrir (so em terminais novos)
  if (initCommand && initCommand.trim()) {
    setTimeout(() => { try { term.write(initCommand + '\r'); } catch {} }, 600);
  }

  term.onData((data) => {
    rec.buffer += data;
    if (rec.buffer.length > MAX_BUFFER) {
      rec.buffer = rec.buffer.slice(rec.buffer.length - MAX_BUFFER);
    }
    broadcast({ type: 'data', id, data });
  });

  term.onExit(({ exitCode }) => {
    terminals.delete(id);
    broadcast({ type: 'exit', id, exitCode });
    maybeExit();
  });

  terminals.set(id, rec);
  log(`Terminal criado: ${id} (${repoName}) em ${safeCwd}`);
}

function listTerminals() {
  return [...terminals.entries()].map(([id, r]) => ({
    id, repoId: r.repoId, repoName: r.repoName, name: r.name, cwd: r.cwd,
  }));
}

function handle(sock, msg) {
  switch (msg.type) {
    case 'list':
      send(sock, { type: 'list', terminals: listTerminals() });
      break;
    case 'create':
      createTerminal(msg);
      send(sock, { type: 'created', id: msg.id });
      break;
    case 'attach': {
      const rec = terminals.get(msg.id);
      if (rec) {
        if (msg.cols && msg.rows) { try { rec.pty.resize(msg.cols, msg.rows); } catch {} }
        send(sock, { type: 'buffer', id: msg.id, data: rec.buffer });
      }
      break;
    }
    case 'input': {
      const rec = terminals.get(msg.id);
      if (rec) rec.pty.write(msg.data);
      break;
    }
    case 'resize': {
      const rec = terminals.get(msg.id);
      if (rec && msg.cols > 0 && msg.rows > 0) { try { rec.pty.resize(msg.cols, msg.rows); } catch {} }
      break;
    }
    case 'rename': {
      const rec = terminals.get(msg.id);
      if (rec) rec.name = msg.name || '';
      break;
    }
    case 'kill': {
      const rec = terminals.get(msg.id);
      if (rec) { try { rec.pty.kill(); } catch {} }
      break;
    }
  }
}

const server = net.createServer((sock) => {
  clients.add(sock);
  log(`Cliente conectado (total: ${clients.size}).`);
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      handle(sock, msg);
    }
  });
  sock.on('close', () => {
    clients.delete(sock);
    log(`Cliente desconectado (restam: ${clients.size}, terminais: ${terminals.size}).`);
    maybeExit();
  });
  sock.on('error', () => { clients.delete(sock); });
});

server.on('error', (e) => {
  log('Erro no servidor (provavelmente daemon ja rodando): ' + e.message);
  process.exit(1);
});

server.listen(PIPE, () => {
  log(`Daemon ouvindo em ${PIPE} (pid ${process.pid}).`);
});
