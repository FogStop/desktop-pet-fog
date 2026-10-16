@echo off
chcp 65001 >nul
setlocal

REM ---------------------------------------------------------------
REM  push-to-github.cmd  --  push local repo to GitHub
REM
REM  Usage (HTTPS, recommended):
REM      push-to-github.cmd https://github.com/FogStop/desktop-pet-fog.git
REM
REM  Usage (SSH, if you have a key registered on GitHub):
REM      push-to-github.cmd git@github.com:<USER>/<REPO>.git
REM
REM  Before running: create an EMPTY repository on GitHub first
REM  (do NOT tick "Add a README" / ".gitignore" / "license",
REM   otherwise the first push will be rejected as non-fast-forward).
REM ---------------------------------------------------------------

if "%~1"=="" (
  echo [!] Missing remote URL.
  echo.
  echo   Usage: push-to-github.cmd https://github.com/^<USER^>/^<REPO^>.git
  echo   Usage: push-to-github.cmd git@github.com:^<USER^>/^<REPO^>.git
  exit /b 1
)

echo [*] Setting remote: %~1
git remote remove origin >nul 2>&1
git remote add origin "%~1"
if errorlevel 1 (
  echo [!] Failed to add remote.
  exit /b 1
)

echo [*] Ensuring branch name is "main"
git branch -M main

echo [*] Pushing...
git push -u origin main
if errorlevel 1 (
  echo.
  echo [!] Push failed.
  echo     - HTTPS: GitHub no longer accepts your account password.
  echo       Use a Personal Access Token instead, or install Git Credential Manager.
  echo     - SSH:   make sure your public key is added on GitHub and the agent is running.
  echo     - Empty repo required: no README / .gitignore / license on the GitHub side.
  exit /b 1
)

echo.
echo [OK] Pushed to %~1
