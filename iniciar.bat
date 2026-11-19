@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo === Tacada Certa ===
echo.

if "%PORT%"=="" set PORT=8010
if not exist "data" mkdir data

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"

where node >nul 2>nul
if not errorlevel 1 goto :deps

echo [1/4] Node.js nao encontrado. Instalando LTS com winget...
echo.

set "WINGET="
if exist "%LocalAppData%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LocalAppData%\Microsoft\WindowsApps\winget.exe"
if exist "%ProgramFiles%\WindowsApps\Microsoft.DesktopAppInstaller_*\winget.exe" (
  for /d %%D in ("%ProgramFiles%\WindowsApps\Microsoft.DesktopAppInstaller_*") do if exist "%%D\winget.exe" set "WINGET=%%D\winget.exe"
)
where winget >nul 2>nul
if not errorlevel 1 if not defined WINGET set "WINGET=winget"

if not defined WINGET (
  echo winget nao encontrado. Instale o "Instalador de Aplicativos" da Microsoft Store
  echo e rode este arquivo de novo.
  pause
  exit /b 1
)

"%WINGET%" install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo.
  echo Falha no winget. Tentando atualizar a origem e instalar de novo...
  "%WINGET%" source update
  "%WINGET%" install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo.
    echo Nao foi possivel instalar o Node.js.
    echo Abra um Prompt e rode:  winget install --id OpenJS.NodeJS.LTS -e
    pause
    exit /b 1
  )
)

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js instalado, mas este Prompt ainda nao ve o comando.
  echo Feche esta janela e execute iniciar.bat outra vez.
  pause
  exit /b 1
)

echo.
echo Node.js:
node -v
echo.

:deps
echo [2/4] Instalando dependencias npm...
echo.
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo.
  echo Falha ao instalar dependencias npm.
  pause
  exit /b 1
)

echo.
echo [3/4] Gerando a interface...
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo Falha ao gerar a interface.
  pause
  exit /b 1
)

echo.
echo [4/4] Iniciando servidor na porta %PORT%...
echo.
node server\watchdog.js
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo Servidor encerrado.
  pause
)
exit /b %EXITCODE%
