@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\APPLY_FIX9_AND_BUILD.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" (
  echo FIX9 build failed with exit code %EXIT_CODE%.
  pause
  exit /b %EXIT_CODE%
)
echo FIX9 build completed successfully.
pause
