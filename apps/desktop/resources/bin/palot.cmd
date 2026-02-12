@echo off
:: palot.cmd — Open the installed Palot desktop application on Windows.
::
:: This script is bundled with the Palot installation and can be added
:: to PATH by the "Install CLI Command" action.

setlocal

set "SCRIPT_DIR=%~dp0"
set "APP_EXE=%SCRIPT_DIR%..\Palot.exe"

if exist "%APP_EXE%" (
    start "" "%APP_EXE%" %*
) else (
    echo Error: Could not find Palot.exe at %APP_EXE% 1>&2
    echo Try launching from the Start Menu instead. 1>&2
    exit /b 1
)
