# Build / Geração do executável

App Electron (`@xterm/xterm` + `node-pty`), empacotado com `electron-builder`.

## Gerar o instalador `.exe`

```powershell
npm run dist
```

Saída em `dist\`:

- **`Terminals Setup <versão>.exe`** — instalador NSIS (escolhe pasta, cria atalhos). É o que se distribui.
- **`dist\win-unpacked\Terminals.exe`** — versão portátil (roda direto, sem instalar).

Outros scripts:

- `npm run pack` — só empacota (`--dir`), sem gerar instalador.
- `npm start` — roda o app em desenvolvimento.
- `npm run rebuild` — recompila o `node-pty` nativo para a versão do Electron.

## Problema conhecido: erro de symlink no `winCodeSign` (Windows)

Ao rodar `npm run dist` numa máquina nova, o build pode falhar com:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
  ...winCodeSign\<n>\darwin\10.12\lib\libcrypto.dylib
cannot execute  cause=exit status 2
```

**Causa:** o `electron-builder` baixa o pacote `winCodeSign` (ferramentas de assinatura)
e tenta extraí-lo. Dentro dele há *symlinks de arquivos do macOS* (`darwin/...`). Criar
symlink no Windows exige o **Modo de Desenvolvedor** ligado (ou shell como admin); sem
isso o `7za` falha e aborta o build inteiro — mesmo sem assinarmos o app e mesmo esses
arquivos sendo só do macOS.

**Solução aplicada (pré-extrair o pacote sem as pastas de Mac/Linux no cache):**

```powershell
$z     = "node_modules\7zip-bin\win\x64\7za.exe"
$cache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
$src   = Get-ChildItem "$cache\*.7z" | Select-Object -First 1   # pacote já baixado
& $z x $src.FullName "-o$cache\winCodeSign-2.6.0" -xr!darwin -xr!linux -y
```

Isso popula `…\winCodeSign\winCodeSign-2.6.0\windows-10\x64\signtool.exe`, que é o
caminho que o `electron-builder` procura. Como passa a estar em cache, **os próximos
builds não repetem o erro**.

> Se o pacote `.7z` não estiver no cache, rode `npm run dist` uma vez para baixá-lo
> (vai falhar na extração), depois rode o comando acima e rode `npm run dist` de novo.

**Alternativas:** ligar o *Modo de Desenvolvedor* do Windows (Configurações →
Privacidade e segurança → Para desenvolvedores) ou rodar o build num terminal como
administrador — ambos concedem o privilégio de criar symlinks.
