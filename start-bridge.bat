@echo off
REM Round Remote bridge for Windows: Roon, UPnP/DLNA and Google Cast from this PC.
REM The GitHub Pages app finds it automatically (Chrome asks once to allow local network access).
cd /d "%~dp0bridge"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Download it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing bridge dependencies...
  call npm install --omit=dev --no-audit --no-fund
)
if not exist node_modules\androidtv-remote (
  echo Adding the Google TV remote add-on...
  call npm install --no-save --no-audit --no-fund androidtv-remote
)
echo.
echo Round Remote bridge running at http://127.0.0.1:8765/  (close this window to stop it)
node server.js
pause
