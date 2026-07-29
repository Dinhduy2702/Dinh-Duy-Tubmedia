@echo off
setlocal
cd /d "%~dp0"
title Tubmedia Next Fixed - Verify and Build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0VERIFY_AND_BUILD_FIXED_WINDOWS.ps1" -BuildInstaller
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo KIEM TRA HOAC BUILD THAT BAI. Xem log tai %%LOCALAPPDATA%%\Tubmedia\VerificationLogs
) else (
  echo HOAN TAT. Installer nam trong thu muc release.
)
echo.
pause
exit /b %EXIT_CODE%
