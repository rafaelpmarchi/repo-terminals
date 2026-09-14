/* global Terminal, FitAddon, CanvasAddon, SearchAddon, WebLinksAddon */

const repoListEl = document.getElementById('repo-list');
const tabsEl = document.getElementById('tabs');
const terminalsEl = document.getElementById('terminals');
const emptyStateEl = document.getElementById('empty-state');
const addRepoBtn = document.getElementById('add-repo');

let repos = [];                 // [{ id, name, path, color }]
const sessions = new Map();     // termId -> { repoId, term, fitAddon, pane, running, name }
const termOrder = [];           // ordem de exibicao dos terminais (termIds)
const expanded = new Set();     // repoIds expandidos na barra lateral
let activeId = null;            // termId ativo
let selectedRepoId = null;      // repo cujas abas aparecem em cima
let renamingId = null;          // termId sendo renomeado (mostra input)
let renamingLoc = null;         // 'tab' ou 'sub' — onde o campo de edicao aparece
let dragRepoId = null;          // repo sendo arrastado
let dragTermId = null;          // terminal sendo arrastado
let splitIds = [];              // termIds exibidos lado a lado (split). vazio = single
let fontSize = parseInt(localStorage.getItem('rt-fontSize') || '13', 10);

// Tempo de silencio (sem saida nova) para considerar que a tarefa terminou.
// So entao a bolinha acende — saida continua (ex.: Claude Code rodando) nao acende.
const IDLE_MS = 5000;

const PALETTE = ['#4ec9b0', '#569cd6', '#c586c0', '#dcdcaa', '#ce9178', '#9cdcfe', '#f44747', '#608b4e'];
const PICKER_COLORS = [
  '#4ec9b0', '#569cd6', '#c586c0', '#dcdcaa', '#ce9178', '#9cdcfe',
  '#f44747', '#608b4e', '#d16969', '#b5cea8', '#e6c07b', '#c8c8c8',
];
function nextColor() { return PALETTE[repos.length % PALETTE.length]; }
function hexToRgba(hex, a) {
  hex = (hex || '#888888').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function contrastText(hex) {
  hex = (hex || '#888888').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#1e1e1e' : '#ffffff';
}

// ---------- Seletor de cores (popover com opcoes padrao) ----------
let popover = null;
function closePopover() {
  if (popover) {
    popover.remove();
    popover = null;
    document.removeEventListener('mousedown', onDocDown, true);
  }
}
function onDocDown(e) { if (popover && !popover.contains(e.target)) closePopover(); }

function openColorPicker(repo, anchor) {
  closePopover();
  popover = document.createElement('div');
  popover.className = 'color-popover';

  PICKER_COLORS.forEach((c) => {
    const sw = document.createElement('span');
    sw.className = 'pc-swatch' + (c.toLowerCase() === (repo.color || '').toLowerCase() ? ' sel' : '');
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => { repo.color = c; persist(); closePopover(); refresh(); });
    popover.appendChild(sw);
  });

  // "+" -> cor personalizada (abre o seletor do Windows)
  const custom = document.createElement('label');
  custom.className = 'pc-custom';
  custom.title = 'Cor personalizada';
  custom.textContent = '+';
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = repo.color || '#888888';
  inp.addEventListener('input', (e) => { repo.color = e.target.value; applyColors(repo); });
  inp.addEventListener('change', (e) => { repo.color = e.target.value; persist(); closePopover(); refresh(); });
  custom.appendChild(inp);
  popover.appendChild(custom);

  document.body.appendChild(popover);
  const r = anchor.getBoundingClientRect();
  popover.style.left = Math.min(r.left, window.innerWidth - popover.offsetWidth - 8) + 'px';
  popover.style.top = (r.bottom + 4) + 'px';
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}

// ---------- Configuracoes do repo (nome / shell / comando ao abrir) ----------
const SHELLS = [['powershell', 'PowerShell'], ['gitbash', 'Git Bash'], ['cmd', 'CMD'], ['wsl', 'WSL']];
function openRepoSettings(repo, anchor) {
  closePopover();
  popover = document.createElement('div');
  popover.className = 'settings-popover';
  popover.addEventListener('mousedown', (e) => e.stopPropagation());

  const addField = (labelText, el) => {
    const lab = document.createElement('label');
    lab.textContent = labelText;
    popover.appendChild(lab);
    popover.appendChild(el);
  };

  const nameInp = document.createElement('input');
  nameInp.type = 'text';
  nameInp.value = repo.name;
  nameInp.addEventListener('change', () => { const v = nameInp.value.trim(); if (v) { repo.name = v; persist(); refresh(); } });

  const shellSel = document.createElement('select');
  SHELLS.forEach(([val, txt]) => {
    const o = document.createElement('option');
    o.value = val; o.textContent = txt;
    if ((repo.shell || 'powershell') === val) o.selected = true;
    shellSel.appendChild(o);
  });
  shellSel.addEventListener('change', () => { repo.shell = shellSel.value; persist(); });

  const cmdInp = document.createElement('input');
  cmdInp.type = 'text';
  cmdInp.placeholder = 'ex.: npm run dev';
  cmdInp.value = repo.startupCommand || '';
  cmdInp.addEventListener('change', () => { repo.startupCommand = cmdInp.value; persist(); });

  [nameInp, cmdInp].forEach((inp) => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); inp.blur(); closePopover(); }
  }));

  const cmdsArea = document.createElement('textarea');
  cmdsArea.rows = 3;
  cmdsArea.placeholder = 'Um comando por linha (ex.: npm run dev)';
  cmdsArea.value = (repo.commands || []).join('\n');
  cmdsArea.addEventListener('change', () => { repo.commands = cmdsArea.value.split('\n').map((s) => s.trim()).filter(Boolean); persist(); refresh(); });

  addField('Nome', nameInp);
  addField('Shell', shellSel);
  addField('Comando ao abrir terminal', cmdInp);
  addField('Comandos rapidos', cmdsArea);
  const hint = document.createElement('div');
  hint.className = 'set-hint';
  hint.textContent = 'Shell e comando valem para novos terminais.';
  popover.appendChild(hint);

  document.body.appendChild(popover);
  const r = anchor.getBoundingClientRect();
  popover.style.left = Math.min(r.left, window.innerWidth - popover.offsetWidth - 8) + 'px';
  popover.style.top = (r.bottom + 4) + 'px';
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}

// ---------- Git (branch / alteracoes) ----------
const gitCache = new Map(); // repoId -> { isRepo, branch, dirty }
async function refreshGit(repo) {
  try {
    const info = await window.api.gitInfo(repo.path);
    gitCache.set(repo.id, info);
  } catch { gitCache.delete(repo.id); }
}
async function refreshAllGit() {
  await Promise.all(repos.map(refreshGit));
  renderSidebar();
}

// ---------- Atividade em segundo plano ----------
// 'working' = saida chegando (azul); 'done' = silencio apos saida (verde, maior)
function termActivityState(tid) {
  const s = sessions.get(tid);
  if (!s || tid === activeId) return null;
  if (s.activity) return 'done';
  if (s.working) return 'working';
  return null;
}
function repoActivityState(repoId) {
  const states = sessionsOf(repoId).map(termActivityState);
  if (states.includes('done')) return 'done';
  if (states.includes('working')) return 'working';
  return null;
}
function actDotHtml(state) {
  if (state === 'done') return '<span class="actdot done" title="Concluido"></span>';
  if (state === 'working') return '<span class="actdot" title="Em atividade"></span>';
  return '';
}

// ---------- Acoes de Git (rodam no terminal do repo) ----------
function runInRepoTerminal(repo, command) {
  const ids = sessionsOf(repo.id);
  let termId;
  let fresh = false;
  if (ids.length) {
    termId = (activeId && sessions.get(activeId) && sessions.get(activeId).repoId === repo.id)
      ? activeId : ids[ids.length - 1];
  } else {
    termId = genTermId();
    buildSession(repo, termId, 'create');
    fresh = true;
  }
  activate(termId);
  const delay = fresh ? 900 : 60; // se acabou de criar, espera o shell subir
  setTimeout(() => window.api.daemonSend({ type: 'input', id: termId, data: command + '\r' }), delay);
  setTimeout(() => refreshGit(repo).then(renderSidebar), 3500); // atualiza branch/estado depois
}

function positionPopover(anchor) {
  const r = anchor.getBoundingClientRect();
  popover.style.left = Math.min(r.left, window.innerWidth - popover.offsetWidth - 8) + 'px';
  popover.style.top = (r.bottom + 4) + 'px';
}

function openGitMenu(repo, anchor) {
  closePopover();
  popover = document.createElement('div');
  popover.className = 'git-menu';
  const item = (label, fn) => {
    const b = document.createElement('div');
    b.className = 'git-item';
    b.textContent = label;
    b.addEventListener('click', fn);
    popover.appendChild(b);
  };
  item('↓ Pull', () => { closePopover(); runInRepoTerminal(repo, 'git pull'); });
  item('↑ Push', () => { closePopover(); runInRepoTerminal(repo, 'git push'); });
  item('✎ Commit + Push', () => {
    closePopover();
    const m = window.prompt('Mensagem do commit:');
    if (m && m.trim()) {
      const msg = m.replace(/"/g, '\\"');
      runInRepoTerminal(repo, `git add -A; git commit -m "${msg}"; git push`);
    }
  });
  const sep = document.createElement('div'); sep.className = 'git-sep'; popover.appendChild(sep);
  item('⎇ Trocar branch...', async () => {
    const branches = await window.api.gitBranches(repo.path);
    popover.innerHTML = '';
    if (!branches.length) { item('(sem branches)', () => {}); return; }
    branches.forEach((b) => item('⎇ ' + b, () => { closePopover(); runInRepoTerminal(repo, `git checkout ${b}`); }));
  });
  document.body.appendChild(popover);
  positionPopover(anchor);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}

function openCommandsMenu(repo, anchor) {
  closePopover();
  popover = document.createElement('div');
  popover.className = 'git-menu';
  (repo.commands || []).forEach((cmd) => {
    const b = document.createElement('div');
    b.className = 'git-item';
    b.textContent = cmd;
    b.addEventListener('click', () => { closePopover(); runInRepoTerminal(repo, cmd); });
    popover.appendChild(b);
  });
  document.body.appendChild(popover);
  positionPopover(anchor);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}

// ---------- Init ----------
async function init() {
  repos = await window.api.loadRepos();
  let changed = false;
  repos.forEach((r, i) => { if (!r.color) { r.color = PALETTE[i % PALETTE.length]; changed = true; } });
  if (changed) persist();
  refresh();
  window.api.daemonSend({ type: 'list' });
  refreshAllGit();
  window.addEventListener('focus', refreshAllGit);
}

function persist() { window.api.saveRepos(repos); }

function baseName(p) { return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p; }
function genRepoId() { return 'r' + Date.now() + Math.floor(Math.random() * 1000); }
function genTermId() { return 't' + Date.now() + Math.floor(Math.random() * 100000); }

function sessionsOf(repoId) {
  return termOrder.filter((tid) => { const s = sessions.get(tid); return s && s.repoId === repoId; });
}

// ---------- Nomes dos terminais ----------
function customName(tid) { const s = sessions.get(tid); return s && s.name ? s.name : ''; }
function repoOrdinal(tid) {
  const s = sessions.get(tid);
  const repo = repos.find((r) => r.id === s.repoId);
  const base = repo ? repo.name : '?';
  const ids = sessionsOf(s.repoId);
  return ids.length > 1 ? `${base} ${ids.indexOf(tid) + 1}` : base;
}
function tabLabel(tid) { return customName(tid) || repoOrdinal(tid); }
function subLabel(tid) {
  const c = customName(tid);
  if (c) return c;
  const s = sessions.get(tid);
  const ids = sessionsOf(s.repoId);
  return 'Terminal ' + (ids.indexOf(tid) + 1);
}

// ---------- Renomear (edicao inline) ----------
function makeRenameInput(tid, current) {
  const inp = document.createElement('input');
  inp.className = 'rename-input';
  inp.value = current;
  let committed = false;
  const finish = (save) => {
    if (committed) return;
    committed = true;
    if (save) {
      const s = sessions.get(tid);
      if (s) {
        s.name = inp.value.trim();
        window.api.daemonSend({ type: 'rename', id: tid, name: s.name });
      }
    }
    renamingId = null;
    renamingLoc = null;
    refresh();
  };
  inp.addEventListener('click', (e) => e.stopPropagation());
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
  return inp;
}
function startRename(tid, loc) {
  renamingId = tid;
  renamingLoc = loc;
  refresh();
  requestAnimationFrame(() => {
    const el = document.querySelector('.rename-input');
    if (el) { el.focus(); el.select(); }
  });
}

// ---------- Render ----------
function refresh() {
  renderSidebar();
  renderTabs();
  updateEmptyState();
}

function toggleExpand(repoId) {
  if (expanded.has(repoId)) expanded.delete(repoId);
  else expanded.add(repoId);
  renderSidebar();
}

function renderSidebar() {
  repoListEl.innerHTML = '';
  for (const repo of repos) {
    const ids = sessionsOf(repo.id);
    const count = ids.length;
    const isOpen = expanded.has(repo.id);

    const li = document.createElement('li');
    li.className = 'repo-item';
    li.dataset.id = repo.id;
    li.draggable = true;
    li.style.borderLeftColor = repo.color || '#3a3a3a';
    if (repo.id === selectedRepoId) {
      li.classList.add('active');
      li.style.background = hexToRgba(repo.color, 0.25);
    }
    if (count > 0) li.classList.add('running');

    const head = count > 0
      ? `<span class="caret${isOpen ? ' open' : ''}" title="Mostrar/esconder">&#8250;</span>`
      : `<span class="dot"></span>`;

    const gi = gitCache.get(repo.id);
    let branchHtml = '';
    if (gi && gi.isRepo && gi.branch) {
      const ab = [];
      if (gi.ahead) ab.push('↑' + gi.ahead);
      if (gi.behind) ab.push('↓' + gi.behind);
      const abTxt = ab.length ? ' ' + ab.join(' ') : '';
      branchHtml = `<span class="branch${gi.dirty ? ' dirty' : ''}" title="Git: pull / push${gi.dirty ? ' (alteracoes nao salvas)' : ''}">&#9095; ${gi.branch}${abTxt}</span>`;
    }
    const actHtml = !isOpen ? actDotHtml(repoActivityState(repo.id)) : '';

    li.innerHTML = `
      <div class="repo-name-row">
        <span class="open-folder" title="Abrir no Explorer">&#128193;</span>
        <span class="name" title="${repo.path}">${repo.name}</span>
      </div>
      <div class="repo-top">
        ${head}
        ${branchHtml}
        ${actHtml}
        <span class="spacer"></span>
        <span class="settings" title="Configuracoes do repo">&#9881;</span>
        <span class="swatch" style="background:${repo.color || '#888'}" title="Escolher cor"></span>
        <span class="remove" title="Remover repo">&times;</span>
      </div>
    `;
    li.querySelector('.name').addEventListener('click', () => openRepo(repo));
    li.querySelector('.open-folder').addEventListener('click', (e) => { e.stopPropagation(); window.api.openFolder(repo.path); });
    const caret = li.querySelector('.caret');
    if (caret) caret.addEventListener('click', (e) => { e.stopPropagation(); toggleExpand(repo.id); });
    const dot = li.querySelector('.dot');
    if (dot) dot.addEventListener('click', () => openRepo(repo));
    li.querySelector('.settings').addEventListener('click', (e) => { e.stopPropagation(); openRepoSettings(repo, e.currentTarget); });
    const br = li.querySelector('.branch');
    if (br) br.addEventListener('click', (e) => { e.stopPropagation(); openGitMenu(repo, br); });
    const sw = li.querySelector('.swatch');
    sw.addEventListener('click', (e) => { e.stopPropagation(); openColorPicker(repo, sw); });
    li.querySelector('.remove').addEventListener('click', (e) => {
      e.stopPropagation();
      const n = sessionsOf(repo.id).length;
      const msg = `Remover "${repo.name}" da lista?` + (n ? `\n\nIsso vai fechar ${n} terminal(is) aberto(s) deste repo.` : '');
      if (window.confirm(msg)) removeRepo(repo);
    });

    // Drag & drop para reordenar repos
    li.addEventListener('dragstart', (e) => { dragRepoId = repo.id; dragTermId = null; e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragend', () => { dragRepoId = null; document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over')); });
    li.addEventListener('dragover', (e) => {
      if (dragRepoId && dragRepoId !== repo.id) { e.preventDefault(); li.classList.add('drag-over'); }
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', (e) => { e.preventDefault(); li.classList.remove('drag-over'); dropRepo(repo, e); });

    repoListEl.appendChild(li);

    if (isOpen) {
      ids.forEach((tid) => {
        const sub = document.createElement('li');
        sub.className = 'term-sub' + (tid === activeId ? ' active' : '');
        if (tid === activeId) sub.style.background = hexToRgba(repo.color, 0.25);
        const editing = renamingId === tid && renamingLoc === 'sub';
        const s = sessions.get(tid);
        const nameHtml = editing ? '' : `<span class="name" title="Duplo clique para renomear">${subLabel(tid)}</span>`;
        const subAct = actDotHtml(termActivityState(tid));
        sub.innerHTML = `
          <span class="ticon" style="color:${repo.color}">&#9656;</span>
          ${nameHtml}
          ${subAct}
          <span class="close" title="Fechar">&times;</span>
        `;
        if (editing) {
          sub.insertBefore(makeRenameInput(tid, customName(tid) || subLabel(tid)), sub.querySelector('.close'));
        } else {
          const nm = sub.querySelector('.name');
          nm.addEventListener('click', () => activate(tid));
          nm.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(tid, 'sub'); });
        }
        sub.querySelector('.ticon').addEventListener('click', () => activate(tid));
        sub.querySelector('.close').addEventListener('click', (e) => { e.stopPropagation(); closeSession(tid); });

        // Drag & drop para reordenar terminais dentro do mesmo repo
        sub.draggable = true;
        sub.addEventListener('dragstart', (e) => { dragTermId = tid; dragRepoId = null; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); });
        sub.addEventListener('dragend', () => { dragTermId = null; document.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over')); });
        sub.addEventListener('dragover', (e) => {
          const d = dragTermId && sessions.get(dragTermId);
          if (d && dragTermId !== tid && d.repoId === repo.id) { e.preventDefault(); sub.classList.add('drag-over'); }
        });
        sub.addEventListener('dragleave', () => sub.classList.remove('drag-over'));
        sub.addEventListener('drop', (e) => { e.preventDefault(); sub.classList.remove('drag-over'); dropTerm(tid, e); });

        repoListEl.appendChild(sub);
      });
    }
  }
}

// Atualiza as cores na tela ao vivo enquanto o usuario mexe no seletor (sem re-render completo)
function applyColors(repo) {
  const li = repoListEl.querySelector(`.repo-item[data-id="${repo.id}"]`);
  if (li) li.style.borderLeftColor = repo.color;
}

function dropRepo(targetRepo, e) {
  if (!dragRepoId || dragRepoId === targetRepo.id) return;
  const from = repos.findIndex((r) => r.id === dragRepoId);
  if (from < 0) return;
  const [moved] = repos.splice(from, 1);
  let to = repos.findIndex((r) => r.id === targetRepo.id);
  const li = repoListEl.querySelector(`.repo-item[data-id="${targetRepo.id}"]`);
  if (li) {
    const rect = li.getBoundingClientRect();
    if (e.clientY - rect.top > rect.height / 2) to += 1;
  }
  repos.splice(to, 0, moved);
  persist();
  refresh();
}

function dropTerm(targetTid, e) {
  const d = dragTermId && sessions.get(dragTermId);
  const t = sessions.get(targetTid);
  if (!d || !t || dragTermId === targetTid || d.repoId !== t.repoId) return;
  const from = termOrder.indexOf(dragTermId);
  if (from < 0) return;
  termOrder.splice(from, 1);
  let to = termOrder.indexOf(targetTid);
  const li = e.currentTarget;
  if (li) { const rect = li.getBoundingClientRect(); if (e.clientY - rect.top > rect.height / 2) to += 1; }
  termOrder.splice(to, 0, dragTermId);
  renderSidebar();
  renderTabs();
}

// Abas em cima: somente os terminais do repo selecionado
function renderTabs() {
  tabsEl.innerHTML = '';
  for (const tid of sessionsOf(selectedRepoId)) {
    const s = sessions.get(tid);
    const repo = repos.find((r) => r.id === s.repoId);
    const color = (repo && repo.color) || '#0e639c';
    const tab = document.createElement('div');
    const inSplit = isSplit() && splitIds.includes(tid);
    tab.className = 'tab' + (tid === activeId ? ' active' : '') + (inSplit ? ' in-split' : '');
    if (tid === activeId) {
      tab.style.background = color;
      tab.style.color = contrastText(color);
    }
    if (renamingId === tid && renamingLoc === 'tab') {
      tab.appendChild(makeRenameInput(tid, customName(tid) || tabLabel(tid)));
      const close = document.createElement('span');
      close.className = 'close';
      close.innerHTML = '&times;';
      tab.appendChild(close);
    } else {
      const act = actDotHtml(termActivityState(tid));
      tab.innerHTML = `${act}<span class="tname" title="Duplo clique para renomear">${tabLabel(tid)}</span>`
        + `<span class="tsplit${splitIds.includes(tid) ? ' on' : ''}" title="Mostrar/ocultar lado a lado (split)">&#9707;</span>`
        + `<span class="close" title="Fechar">&times;</span>`;
      const tn = tab.querySelector('.tname');
      tn.addEventListener('click', () => activate(tid));
      tn.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(tid, 'tab'); });
      tab.querySelector('.tsplit').addEventListener('click', (e) => { e.stopPropagation(); toggleSplitMember(tid); });
      tab.querySelector('.close').addEventListener('click', (e) => { e.stopPropagation(); closeSession(tid); });
    }
    tabsEl.appendChild(tab);
  }

  // Botoes a direita das abas (comandos rapidos + novo terminal)
  if (selectedRepoId) {
    const repo = repos.find((r) => r.id === selectedRepoId);
    if (repo) {
      if (repo.commands && repo.commands.length) {
        const cmds = document.createElement('div');
        cmds.className = 'tab-add';
        cmds.title = 'Comandos rapidos';
        cmds.textContent = '⚡';
        cmds.addEventListener('click', () => openCommandsMenu(repo, cmds));
        tabsEl.appendChild(cmds);
      }
      const add = document.createElement('div');
      add.className = 'tab-add';
      add.title = `Novo terminal em ${repo.name}`;
      add.textContent = '+';
      add.addEventListener('click', () => newTerminal(repo));
      tabsEl.appendChild(add);
    }
  }
}

function updateEmptyState() {
  const hasActive = activeId && sessions.has(activeId);
  emptyStateEl.classList.toggle('hidden', !!hasActive);
  if (!hasActive) {
    const msg = emptyStateEl.querySelector('.es-msg');
    if (msg) {
      const repo = repos.find((r) => r.id === selectedRepoId);
      msg.textContent = repo
        ? `Clique no + acima para abrir um terminal em "${repo.name}".`
        : 'Selecione um repositorio na barra lateral.';
    }
  }
}

// ---------- Repos ----------
async function addRepo() {
  const folder = await window.api.pickFolder();
  if (!folder) return;
  const existing = repos.find((r) => r.path === folder);
  if (existing) { openRepo(existing); return; }
  const repo = { id: genRepoId(), name: baseName(folder), path: folder, color: nextColor() };
  repos.push(repo);
  persist();
  openRepo(repo);
}

function removeRepo(repo) {
  for (const tid of sessionsOf(repo.id)) closeSession(tid);
  repos = repos.filter((r) => r.id !== repo.id);
  if (selectedRepoId === repo.id) selectedRepoId = null;
  persist();
  refresh();
}

// ---------- Colar (imagem ou texto) ----------
// Envolve o texto colado em "bracketed paste" quando o shell tem esse modo ativo,
// para que varias linhas cheguem como uma unica colagem (e nao executem linha a linha).
function sendPaste(termId, text) {
  if (!text) return;
  const s = sessions.get(termId);
  const bracketed = s && s.term && s.term.modes && s.term.modes.bracketedPasteMode;
  // Normaliza CRLF/CR para LF; o shell trata cada LF como nova linha dentro da colagem.
  const data = text.replace(/\r\n?/g, '\n');
  if (bracketed) {
    window.api.daemonSend({ type: 'input', id: termId, data: '\x1b[200~' + data + '\x1b[201~' });
  } else {
    window.api.daemonSend({ type: 'input', id: termId, data });
  }
}

async function handlePaste(termId) {
  let imgPath = null;
  try { imgPath = await window.api.pasteImage(); } catch {}
  if (imgPath) {
    window.api.daemonSend({ type: 'input', id: termId, data: '"' + imgPath + '" ' });
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    sendPaste(termId, text);
  } catch {}
}

// ---------- Terminais ----------
function buildSession(repo, termId, mode, name = '') {
  const term = new Terminal({
    fontFamily: 'Cascadia Code, Consolas, monospace',
    fontSize,
    cursorBlink: true,
    scrollback: 5000,
    theme: { background: '#1e1e1e', foreground: '#dddddd' },
  });
  const fitAddon = new FitAddon.FitAddon();
  const searchAddon = new SearchAddon.SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((event, uri) => window.api.openExternal(uri)));

  const pane = document.createElement('div');
  pane.className = 'term-pane';
  pane.dataset.id = termId;
  terminalsEl.appendChild(pane);
  term.open(pane);
  // O renderer Canvas e o primeiro fit() sao adiados ate o painel ficar VISIVEL
  // (ver ensureRendered). Inicializar com o painel escondido (display:none, 0px)
  // gera dimensoes zeradas no Canvas e trava a rolagem ate um resize forcar o repintar.

  // Copiar ao selecionar
  term.onSelectionChange(() => {
    const sel = term.getSelection();
    if (sel) navigator.clipboard.writeText(sel).catch(() => {});
  });
  // Colar com botao direito
  pane.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    try { const t = await navigator.clipboard.readText(); sendPaste(termId, t); } catch {}
  });
  // Ctrl+V: se houver imagem no clipboard, salva .png e insere o caminho; senao cola texto
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault(); // evita o colar nativo (que duplicaria o texto)
      handlePaste(termId);
      return false;
    }
    // Ctrl+C: se houver texto selecionado, copia (e nao manda SIGINT).
    // Sem selecao, deixa passar para o shell (Ctrl+C = interromper o processo).
    if (e.type === 'keydown' && e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      const sel = term.getSelection();
      if (sel) {
        e.preventDefault();
        navigator.clipboard.writeText(sel).catch(() => {});
        term.clearSelection();
        return false;
      }
      // sem selecao: nao previne -> Ctrl+C segue para o shell (SIGINT)
    }
    // Shift+Enter: quebra de linha (LF) sem executar o comando.
    // Enter normal continua enviando \r (executa).
    if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      window.api.daemonSend({ type: 'input', id: termId, data: '\n' });
      return false;
    }
    return true;
  });

  // Clicar no painel torna-o o ativo (no split, troca o foco sem sair do split)
  pane.addEventListener('mousedown', () => { if (activeId !== termId) focusActive(termId); });

  if (mode === 'create') {
    window.api.daemonSend({
      type: 'create', id: termId, repoId: repo.id, repoName: repo.name, name,
      cwd: repo.path, cols: term.cols, rows: term.rows,
      shell: repo.shell || 'powershell', initCommand: repo.startupCommand || '',
    });
  } else {
    window.api.daemonSend({ type: 'attach', id: termId, cols: term.cols, rows: term.rows });
  }

  term.onData((data) => window.api.daemonSend({ type: 'input', id: termId, data }));
  sessions.set(termId, { repoId: repo.id, term, fitAddon, searchAddon, pane, running: true, name, activity: false, working: false, rendered: false });
  if (!termOrder.includes(termId)) termOrder.push(termId);
  expanded.add(repo.id);
}

// ---------- Visibilidade / split ----------
function isSplit() { return splitIds.filter((id) => sessions.has(id)).length >= 2; }
function visibleIds() {
  if (isSplit()) return splitIds.filter((id) => sessions.has(id));
  return (activeId && sessions.has(activeId)) ? [activeId] : [];
}
function fitVisible() {
  for (const tid of visibleIds()) {
    const s = sessions.get(tid);
    if (!s) continue;
    // Painel escondido/sem layout: medir agora geraria dimensoes erradas (e some a rolagem).
    if (s.pane.offsetWidth === 0 || s.pane.offsetHeight === 0) continue;
    // Se o usuario ja estava no fim, mantem no fim apos reajustar.
    const buf = s.term.buffer.active;
    const atBottom = buf.viewportY >= buf.baseY;
    s.fitAddon.fit();
    window.api.daemonSend({ type: 'resize', id: tid, cols: s.term.cols, rows: s.term.rows });
    if (atBottom) s.term.scrollToBottom();
  }
}
// Reajuste debounced (1x por frame) — usado pelo ResizeObserver para evitar loop/repeticao.
let fitScheduled = false;
function scheduleFit() {
  if (fitScheduled) return;
  fitScheduled = true;
  requestAnimationFrame(() => { fitScheduled = false; fitVisible(); });
}
// Observa o tamanho REAL do container e reajusta sozinho — elimina o
// "maximizar e restaurar a janela" para a rolagem voltar ao fim.
const termResizeObserver = new ResizeObserver(scheduleFit);
termResizeObserver.observe(terminalsEl);
// A fonte (Cascadia Code) costuma carregar depois do terminal abrir, mudando o
// tamanho da celula; sem reajustar, as ultimas linhas ficam inalcancaveis.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleFit);
// Ativa o renderer Canvas e faz o primeiro fit somente quando o painel ja esta
// visivel (1a vez). Evita o Canvas nascer com 0px e a rolagem travar.
function ensureRendered(s) {
  if (!s || s.rendered) return;
  if (s.pane.offsetWidth === 0 || s.pane.offsetHeight === 0) return; // ainda nao visivel
  s.rendered = true;
  // Renderer acelerado (Canvas): evita travar a rolagem com muita saida.
  // Se falhar (ex.: ambiente sem canvas), o xterm cai no renderer DOM padrao.
  try { s.term.loadAddon(new CanvasAddon.CanvasAddon()); } catch (e) { /* mantem DOM */ }
}
function applyVisibility() {
  const vis = visibleIds();
  terminalsEl.classList.toggle('split', vis.length >= 2);
  for (const [tid, s] of sessions) {
    s.pane.classList.toggle('show', vis.includes(tid));
    s.pane.classList.toggle('focused', vis.length >= 2 && tid === activeId);
  }
  requestAnimationFrame(() => {
    for (const tid of visibleIds()) ensureRendered(sessions.get(tid));
    fitVisible();
  });
}
function focusActive(termId) {
  if (!sessions.has(termId)) return;
  activeId = termId;
  selectedRepoId = sessions.get(termId).repoId;
  sessions.get(termId).activity = false;
  applyVisibility();
  renderTabs();
  renderSidebar();
}
// Coloca/tira um terminal do split. Clicar no ⊟ de outra aba divide com a atual.
function toggleSplitMember(tid) {
  const s = sessions.get(tid);
  if (!s) return;
  const i = splitIds.indexOf(tid);
  if (i >= 0) {
    splitIds.splice(i, 1);
  } else {
    const cur = sessions.get(activeId);
    if (!splitIds.length && cur && activeId !== tid && cur.repoId === s.repoId) {
      splitIds = [activeId, tid]; // primeiro split: atual + a escolhida
    } else {
      splitIds = splitIds.filter((id) => { const x = sessions.get(id); return x && x.repoId === s.repoId; });
      splitIds.push(tid);
    }
    activeId = tid;
    selectedRepoId = s.repoId;
  }
  applyVisibility();
  refresh();
}

function newTerminal(repo) {
  const termId = genTermId();
  buildSession(repo, termId, 'create');
  activate(termId);
}

function openRepo(repo) {
  selectedRepoId = repo.id;
  const ids = sessionsOf(repo.id);
  if (ids.length) { activate(ids[ids.length - 1]); return; }
  // Repo sem terminais: apenas seleciona (nao cria sozinho — usar o "+" da aba)
  activeId = null;
  splitIds = [];
  applyVisibility();
  refresh();
}

function activate(termId) {
  const session = sessions.get(termId);
  if (!session) return;
  activeId = termId;
  selectedRepoId = session.repoId;
  session.activity = false; // foi visto -> limpa o aviso
  if (!splitIds.includes(termId)) splitIds = []; // foi pra um terminal fora do split -> sai do split
  applyVisibility();
  requestAnimationFrame(() => session.term.focus());
  refresh();
}

function closeSession(termId) {
  const session = sessions.get(termId);
  if (!session) return;
  const repoId = session.repoId;
  const wasActive = activeId === termId;
  window.api.daemonSend({ type: 'kill', id: termId });
  clearTimeout(session.idleTimer);
  session.term.dispose();
  session.pane.remove();
  sessions.delete(termId);
  const oi = termOrder.indexOf(termId);
  if (oi >= 0) termOrder.splice(oi, 1);
  const si = splitIds.indexOf(termId);
  if (si >= 0) splitIds.splice(si, 1);

  if (wasActive) {
    const same = sessionsOf(repoId);
    const next = same.length ? same[same.length - 1] : [...sessions.keys()].pop();
    if (next) { activate(next); return; }
    activeId = null;
  }
  applyVisibility();
  refresh();
}

function restoreTerminals(list) {
  for (const t of list) {
    let repo = repos.find((r) => r.id === t.repoId);
    if (!repo) {
      repo = { id: t.repoId, name: t.repoName || 'repo', path: t.cwd, color: nextColor() };
      repos.push(repo);
      persist();
    }
    if (!sessions.has(t.id)) buildSession(repo, t.id, 'attach', t.name || '');
  }
  if (!activeId) {
    const first = [...sessions.keys()][0];
    if (first) { activate(first); return; }
  }
  refresh();
}

// ---------- Mensagens do daemon ----------
window.api.onDaemonMsg((msg) => {
  switch (msg.type) {
    case 'list':
      restoreTerminals(msg.terminals);
      break;
    case 'buffer': {
      const s = sessions.get(msg.id);
      if (s) s.term.write(msg.data);
      break;
    }
    case 'data': {
      const s = sessions.get(msg.id);
      if (s) {
        s.term.write(msg.data);
        // Saida nova = em atividade (azul); silencio de IDLE_MS = concluiu (verde).
        if (!s.working || s.activity) { s.working = true; s.activity = false; renderSidebar(); renderTabs(); }
        clearTimeout(s.idleTimer);
        s.idleTimer = setTimeout(() => {
          if (!sessions.has(msg.id)) return;
          s.working = false;
          if (msg.id !== activeId) s.activity = true;
          renderSidebar();
          renderTabs();
        }, IDLE_MS);
      }
      break;
    }
    case 'exit': {
      const s = sessions.get(msg.id);
      if (s) {
        s.running = false;
        s.term.write('\r\n\x1b[33m[processo encerrado]\x1b[0m\r\n');
      }
      break;
    }
  }
});

// ---------- Atalhos / resize ----------
addRepoBtn.addEventListener('click', addRepo);

window.addEventListener('resize', fitVisible);

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Tab') {
    const ids = sessionsOf(selectedRepoId);
    if (ids.length > 1) {
      e.preventDefault();
      const i = ids.indexOf(activeId);
      const next = e.shiftKey ? ids[(i - 1 + ids.length) % ids.length] : ids[(i + 1) % ids.length];
      activate(next);
    }
  }
  if (e.ctrlKey && (e.key === 'w' || e.key === 'W') && activeId) {
    e.preventDefault();
    closeSession(activeId);
  }
  if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); setFontSize(fontSize + 1); }
  else if (e.ctrlKey && e.key === '-') { e.preventDefault(); setFontSize(fontSize - 1); }
  else if (e.ctrlKey && e.key === '0') { e.preventDefault(); setFontSize(13); }
  if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openSearch(); }
  if (e.key === 'Escape' && !searchBar.classList.contains('hidden')) { closeSearch(); }
  if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); openPalette(); }
  if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
    const idx = +e.key - 1;
    if (repos[idx]) { e.preventDefault(); openRepo(repos[idx]); }
  }
});

// ---------- Command palette (Ctrl+P) ----------
function closePalette() {
  const o = document.getElementById('palette-overlay');
  if (o) o.remove();
}
function openPalette() {
  closePalette();
  const overlay = document.createElement('div');
  overlay.id = 'palette-overlay';
  const box = document.createElement('div');
  box.id = 'palette';
  const input = document.createElement('input');
  input.placeholder = 'Buscar repositorio ou terminal...';
  const list = document.createElement('ul');
  box.appendChild(input);
  box.appendChild(list);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const items = [];
  repos.forEach((r) => items.push({ type: 'repo', id: r.id, label: r.name, sub: r.path, color: r.color }));
  for (const tid of termOrder) {
    const s = sessions.get(tid);
    if (!s) continue;
    const repo = repos.find((x) => x.id === s.repoId);
    items.push({ type: 'term', id: tid, label: tabLabel(tid), sub: repo ? repo.name : '', color: repo ? repo.color : '#888' });
  }

  let filtered = items.slice();
  let sel = 0;
  const render = () => {
    list.innerHTML = '';
    filtered.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = 'pal-item' + (i === sel ? ' sel' : '');
      li.innerHTML = `<span class="pal-dot" style="background:${it.color}"></span>`
        + `<span class="pal-label">${it.type === 'term' ? '▸ ' : ''}${it.label}</span>`
        + `<span class="pal-sub">${it.sub || ''}</span>`;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(it); });
      list.appendChild(li);
    });
  };
  const applyFilter = () => {
    const q = input.value.toLowerCase();
    filtered = items.filter((it) => (it.label + ' ' + (it.sub || '')).toLowerCase().includes(q));
    sel = 0;
    render();
  };
  const choose = (it) => {
    closePalette();
    if (it.type === 'repo') { const r = repos.find((x) => x.id === it.id); if (r) openRepo(r); }
    else activate(it.id);
  };
  input.addEventListener('input', applyFilter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[sel]) choose(filtered[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePalette(); });
  render();
  input.focus();
}

// ---------- Zoom de fonte ----------
function setFontSize(n) {
  fontSize = Math.max(8, Math.min(28, n));
  localStorage.setItem('rt-fontSize', String(fontSize));
  for (const [, s] of sessions) s.term.options.fontSize = fontSize;
  fitVisible();
}

// ---------- Busca no terminal ----------
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
function openSearch() {
  if (!activeId) return;
  searchBar.classList.remove('hidden');
  searchInput.focus();
  searchInput.select();
}
function closeSearch() {
  searchBar.classList.add('hidden');
  const s = sessions.get(activeId);
  if (s) { if (s.searchAddon.clearDecorations) s.searchAddon.clearDecorations(); s.term.focus(); }
}
function doSearch(forward) {
  const s = sessions.get(activeId);
  if (!s || !searchInput.value) return;
  if (forward) s.searchAddon.findNext(searchInput.value);
  else s.searchAddon.findPrevious(searchInput.value);
}
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); doSearch(!e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
});
document.getElementById('search-next').addEventListener('click', () => doSearch(true));
document.getElementById('search-prev').addEventListener('click', () => doSearch(false));
document.getElementById('search-close').addEventListener('click', closeSearch);

// ---------- Largura da barra lateral (arrastar a borda) ----------
(function initSidebarResize() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  const saved = parseInt(localStorage.getItem('rt-sidebarW') || '0', 10);
  if (saved >= 160) sidebar.style.width = saved + 'px';
  let dragging = false;
  resizer.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); document.body.style.cursor = 'col-resize'; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(160, Math.min(460, e.clientX));
    sidebar.style.width = w + 'px';
    fitVisible();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    localStorage.setItem('rt-sidebarW', String(parseInt(sidebar.style.width, 10) || 240));
    fitVisible();
  });
})();

// ---------- Arrastar pasta para dentro da janela -> adiciona repo ----------
function addRepoByPath(folder) {
  const existing = repos.find((r) => r.path === folder);
  if (existing) { openRepo(existing); return; }
  const repo = { id: genRepoId(), name: baseName(folder), path: folder, color: nextColor() };
  repos.push(repo);
  persist();
  selectedRepoId = repo.id;
  refresh();
  refreshGit(repo).then(renderSidebar);
}
window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  for (const item of e.dataTransfer.items) {
    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
    if (entry && entry.isDirectory) {
      const f = item.getAsFile();
      if (f && f.path) addRepoByPath(f.path);
    }
  }
});

init();
