# Terminals

Painel de terminais organizado por repositório, para Windows. Feito em Electron com `@xterm/xterm` e `node-pty`.

A ideia é simples: cada repositório na barra lateral tem seus próprios terminais em abas. Os processos rodam num daemon separado, então fechar a janela do app **não mata os terminais**. Ao reabrir, tudo volta como estava, inclusive o scrollback.

## Funcionalidades

- **Repositórios na barra lateral**, com cor personalizada, nome, shell e comando de inicialização por repo. Reordenação por arrastar e soltar.
- **Shells suportados:** PowerShell, cmd, Git Bash e WSL.
- **Terminais persistentes:** um daemon (`src/daemon.js`) segura os `pty` vivos mesmo com o app fechado. Ele encerra sozinho quando não há mais terminais.
- **Indicador de atividade** por terminal: azul enquanto há saída, verde quando a tarefa terminou. Útil para acompanhar tarefas longas em segundo plano.
- **Git integrado:** branch atual, alterações pendentes, ahead/behind e ações rápidas rodando no próprio terminal do repo.
- **Split:** dois terminais lado a lado.
- **Busca no terminal** (Ctrl+F), **paleta de comandos** (Ctrl+P), zoom de fonte.
- **Colagem inteligente:** imagem do clipboard vira um `.png` temporário e o caminho é inserido no terminal. Texto multilinha usa bracketed paste. Shift+Enter quebra linha sem executar.
- **Ctrl+C** copia se houver seleção, senão vai para o shell como interrupção.

## Atalhos

| Atalho | Ação |
|---|---|
| Ctrl+Tab | Alterna entre terminais |
| Ctrl+W | Fecha o terminal atual |
| Ctrl+1 … Ctrl+9 | Vai para o terminal N |
| Ctrl+F | Busca no terminal |
| Ctrl+P | Paleta de comandos |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom da fonte |
| Shift+Enter | Nova linha sem executar |

## Rodando em desenvolvimento

Requisitos: Node.js e ferramentas de build nativas para compilar o `node-pty` (Visual Studio Build Tools com C++).

```powershell
npm install
npm run rebuild   # recompila o node-pty para a versão do Electron
npm start
```

O script `criar-atalho.bat` cria atalhos na Área de Trabalho e no Menu Iniciar apontando para o Electron da pasta `node_modules`, sem precisar gerar instalador.

## Gerando o instalador

```powershell
npm run dist
```

Detalhes e o problema conhecido de symlink no Windows estão em [BUILD.md](BUILD.md).

## Estrutura

```
src/
  main.js      processo principal do Electron, IPC e conexão com o daemon
  daemon.js    host dos terminais (named pipe + node-pty), roda detached
  preload.js   ponte segura entre renderer e main
  renderer.js  interface: repos, abas, xterm, atalhos
  index.html / styles.css
```

## Licença

MIT
