@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Trevean Tag Tool
rem Double click this file to start the Tag Tool. The first time, it sets itself up.
rem Everything is found relative to this file, so the folder can sit anywhere, as
rem long as build\chip-cli and build\edge stay beside this file.

set "TOOL=%~dp0build\chip-cli"
if not exist "%TOOL%\package.json" goto nofolder
pushd "%TOOL%" || goto nofolder

where node >nul 2>nul || goto nonode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=11)?0:1)" || goto oldnode

rem Install on the first run, and again whenever the package list has changed since.
set "INSTALL="
if not exist "node_modules\" set "INSTALL=1"
if not defined INSTALL node -e "const f=require('fs');try{process.exit(f.statSync('package-lock.json').mtimeMs>f.statSync('node_modules/.package-lock.json').mtimeMs?1:0)}catch(e){process.exit(1)}" || set "INSTALL=1"
if defined INSTALL (
  echo.
  echo Setting up the Tag Tool. This needs the internet and takes a minute or two.
  echo.
  call npm ci || goto failed
)

rem Built every time. It takes a few seconds and means an updated copy never runs old code.
echo Preparing the Tag Tool...
call npm run build --silent || goto failed

node bin\tag-tool.mjs %*
if errorlevel 1 goto failed
popd
exit /b 0

:nofolder
echo.
echo The Tag Tool files were not found next to this file.
echo Expected a folder called build\chip-cli here:
echo   %~dp0
echo Keep "Start Tag Tool.cmd" in the same folder as the "build" folder, exactly as it came.
goto stop

:nonode
echo.
echo Node.js is not installed, or this window cannot find it.
echo.
echo   1. Go to nodejs.org and download the LTS Windows Installer (.msi).
echo   2. Run it and accept the defaults. Leave "Tools for Native Modules" unticked.
echo   3. Double click "Start Tag Tool" again.
echo.
echo If Node.js is already installed, restart the computer and try again.
goto stop

:oldnode
echo.
for /f "delims=" %%v in ('node --version') do echo This computer has Node.js %%v, and the Tag Tool needs version 20.11 or newer.
echo Go to nodejs.org, install the LTS version, then double click "Start Tag Tool" again.
goto stop

:failed
echo.
echo ======================================================================
echo  The Tag Tool stopped. The message above says why.
echo  If it is not clear what to do, take a photo of this window or copy
echo  the text, and send it to Serene Labs.
echo ======================================================================
goto stop

:stop
echo.
pause
popd 2>nul
exit /b 1
