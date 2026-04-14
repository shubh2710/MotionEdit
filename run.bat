@echo off
title MotionEdit - Desktop Video Editor
color 0A

echo ============================================
echo    MotionEdit - Desktop Video Editor
echo ============================================
echo.

:: Save the project root directory
set "PROJECT_DIR=%~dp0"

:: -------------------------------------------
:: Step 1: Check Node.js
:: -------------------------------------------
echo [1/5] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo ERROR: Node.js is not installed or not on PATH.
    echo Download it from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo        Found Node %%v

:: -------------------------------------------
:: Step 2: Check Python
:: -------------------------------------------
echo [2/5] Checking Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo WARNING: Python not found. Local FFmpeg export service will be skipped.
    echo          Browser export will still work.
    set "SKIP_PYTHON=1"
) else (
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo        Found %%v
    set "SKIP_PYTHON=0"
)

:: -------------------------------------------
:: Step 3: Install npm dependencies
:: -------------------------------------------
echo.
echo [3/5] Installing npm dependencies...
cd /d "%PROJECT_DIR%"
if not exist "node_modules" (
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo ERROR: npm install failed.
        pause
        exit /b 1
    )
    echo        npm install complete.
) else (
    echo        node_modules exists, skipping. Delete node_modules to force reinstall.
)

:: -------------------------------------------
:: Step 4: Install Python dependencies + start export service
:: -------------------------------------------
echo.
if "%SKIP_PYTHON%"=="1" (
    echo [4/5] Skipping Python export service ^(Python not found^)
) else (
    echo [4/5] Setting up local FFmpeg export service...
    if exist "%PROJECT_DIR%export-service\requirements.txt" (
        echo        Installing Python packages...
        pip install -q -r "%PROJECT_DIR%export-service\requirements.txt" 2>nul
        if %errorlevel% neq 0 (
            echo WARNING: pip install failed. Export service may not work.
        ) else (
            echo        Python packages installed.
        )

        :: Check if FFmpeg is available
        where ffmpeg >nul 2>&1
        if %errorlevel% neq 0 (
            echo.
            echo WARNING: FFmpeg not found on PATH.
            echo          Local export will not work until FFmpeg is installed.
            echo          Download from: https://www.gyan.dev/ffmpeg/builds/
            echo          Browser export will still work fine.
            echo.
        ) else (
            for /f "tokens=3" %%v in ('ffmpeg -version 2^>^&1 ^| findstr /i "ffmpeg version"') do echo        Found FFmpeg %%v
        )

        echo        Starting export service on port 9876...
        start "MotionEdit Export Service" /min cmd /c "cd /d "%PROJECT_DIR%export-service" && python -m uvicorn server:app --host 0.0.0.0 --port 9876"
        echo        Export service started in background.
    ) else (
        echo        export-service folder not found, skipping.
    )
)

:: -------------------------------------------
:: Step 5: Start the application
:: -------------------------------------------
echo.
echo [5/5] Starting MotionEdit...
echo.
echo ============================================
echo    App will open at: http://localhost:5173
echo ============================================
echo.
echo    Press Ctrl+C to stop the server.
echo.

cd /d "%PROJECT_DIR%"
call npm run dev
