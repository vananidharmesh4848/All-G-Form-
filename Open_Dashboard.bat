@echo off
title Multi-Form Dashboard Starter
echo ===================================================
echo 📊 STARTING MULTI-FORM CENTRAL DASHBOARD...
echo ===================================================

:: Check if server is running on port 4343
netstat -ano | findstr :4343 >nul
if %errorlevel% neq 0 (
    echo [1/2] LiveHost server is not running. Starting it now...
    start /min cmd /c "cd /d C:\Users\admin\Desktop\sarver\LiveHost && node server.js"
    echo Waiting for server to initialize...
    timeout /t 3 /nobreak >nul
) else (
    echo [1/2] LiveHost server is already running.
)

echo [2/2] Opening Dashboard links in default browser...
:: Open Local Dashboard served by LiveHost (prevents CORS and file:/// errors)
start "" "http://localhost:4343/f/multi-form-dashboard/index.html"

:: Open Online GitHub Pages Dashboard
start "" "https://vananidharmesh4848.github.io/All-G-Form-/"

echo ===================================================
echo ✅ Done! Opening completed.
echo ===================================================
timeout /t 2 >nul
