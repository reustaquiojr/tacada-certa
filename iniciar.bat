@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o LTS em https://nodejs.org
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=8010
if not exist "data" mkdir data

call npm install --no-fund --no-audit --loglevel=error
if errorlevel 1 (
  echo Falha ao instalar dependencias.
  pause
  exit /b 1
)

call npm run build --silent
if errorlevel 1 (
  echo Falha ao gerar a interface.
  pause
  exit /b 1
)

node server\watchdog.js
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo Servidor encerrado.
  pause
)
exit /b %EXITCODE%
