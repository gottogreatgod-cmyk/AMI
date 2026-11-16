@echo off
setlocal
cd /d "%~dp0"
set "PORT=18765"
if not exist "prototype\index.html" (
  echo Could not find prototype\index.html.
  echo Extract the complete ZIP first, then run this file from the extracted folder.
  pause
  exit /b 1
)
where py >nul 2>nul
if not errorlevel 1 goto use_py
where python >nul 2>nul
if not errorlevel 1 goto use_python

echo Python was not found. Opening the self-contained HTML directly instead.
start "" "%~dp0prototype\index.html"
echo.
echo If the page still does not open, install Python 3 or open prototype\index.html manually in Edge or Chrome.
pause
exit /b 0

:use_py
start "AMI Workstation Local Server" /min cmd /k "cd /d ""%CD%"" && py -m http.server %PORT% --bind 127.0.0.1"
goto open_browser

:use_python
start "AMI Workstation Local Server" /min cmd /k "cd /d ""%CD%"" && python -m http.server %PORT% --bind 127.0.0.1"

:open_browser
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/prototype/"
echo.
echo AMI prototype is opening in your browser.
echo Keep the minimized "AMI Workstation Local Server" window running while viewing it.
echo Close that server window when you finish.
exit /b 0
