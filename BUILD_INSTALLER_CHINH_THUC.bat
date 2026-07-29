@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0BUILD_INSTALLER_CHINH_THUC.ps1"
pause
