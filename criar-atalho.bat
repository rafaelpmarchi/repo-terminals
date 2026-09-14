@echo off
setlocal
chcp 65001 >nul

rem Pasta deste .bat (raiz do projeto), sem a barra final
set "PROJ=%~dp0"
if "%PROJ:~-1%"=="\" set "PROJ=%PROJ:~0,-1%"

echo Criando atalhos para: %PROJ%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$proj='%PROJ%'; $exe=Join-Path $proj 'node_modules\electron\dist\electron.exe'; $ico=Join-Path $proj 'assets\icon.ico'; $q=[char]34; if(-not (Test-Path $exe)){ Write-Host 'ERRO: electron.exe nao encontrado. Rode npm install primeiro.' -ForegroundColor Red; exit 1 }; $ws=New-Object -ComObject WScript.Shell; $targets=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Terminals.lnk'),(Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Repo Terminals.lnk')); foreach($lnk in $targets){ if(Test-Path $lnk){ Remove-Item $lnk -Force }; $sc=$ws.CreateShortcut($lnk); $sc.TargetPath=$exe; $sc.Arguments=$q+$proj+$q; $sc.WorkingDirectory=$proj; if(Test-Path $ico){ $sc.IconLocation=$ico+',0' }; $sc.Description='Painel de terminais por repositorio'; $sc.WindowStyle=1; $sc.Save(); Write-Host ('Criado: '+$lnk) -ForegroundColor Green }; ie4uinit.exe -ClearIconCache; ie4uinit.exe -show"

echo.
echo Pronto! Atalhos criados na Area de Trabalho e no Menu Iniciar.
pause
