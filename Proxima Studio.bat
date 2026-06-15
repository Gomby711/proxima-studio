@echo off
setlocal
title Proxima Studio Launcher
cd /d "%~dp0"

echo ===================================================
echo   PROXIMA STUDIO - building and launching latest
echo ===================================================
echo.
echo IMPORTANT: close any old Proxima Studio windows first.
echo.

echo [1/2] Building the latest version...
call "node_modules\.bin\vite.cmd" build
if errorlevel 1 (
  echo.
  echo *** BUILD FAILED - read the errors above. ***
  echo.
  pause
  exit /b 1
)

echo.
echo [2/2] Launching Proxima Studio...
echo Look for the ORANGE "v3.0 NATIVE-PICKER BUILD" text at the bottom of the window.
echo (You can minimize this console; closing it will close the app.)
echo.
call "node_modules\.bin\electron.cmd" .

echo.
echo Proxima Studio has closed.
pause
