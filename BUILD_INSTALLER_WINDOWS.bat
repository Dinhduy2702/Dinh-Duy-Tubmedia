@echo off
setlocal
cd /d "%~dp0"
call npm.cmd install
if errorlevel 1 exit /b %errorlevel%
call npm.cmd run check
if errorlevel 1 exit /b %errorlevel%
call npm.cmd run dist
