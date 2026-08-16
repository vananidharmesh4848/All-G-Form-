@echo off
echo ===================================================
echo 🚀 STARTING AUTO GIT PUSH TO GITHUB...
echo ===================================================

:: Check if git repository is initialized
if not exist .git (
    echo [1/4] Initializing Git repository...
    git init
) else (
    echo Git repository already initialized.
)

:: Set remote URL
git remote remove origin >nul 2>&1
git remote add origin https://github.com/vananidharmesh4848/All-G-Form-.git
git branch -M main

echo [2/4] Staging files...
git add .

echo [3/4] Committing changes...
git commit -m "Dashboard update: %date% %time%"

echo [4/4] Pushing to GitHub (main)...
git push -u origin main

echo ===================================================
echo ✅ DONE! PUSH COMPLETED.
echo ===================================================
pause
