@echo off
chcp 65001 > nul
setlocal

if "%~1"=="" (
    echo Usage: run.bat ^<input_csv_file^>
    echo.
    echo Example: run.bat sample_input.csv
    exit /b 1
)

python calculate.py "%~1"
pause
