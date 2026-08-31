@echo off
title EduOS AI Launcher
cls
echo ======================================================================
echo                  EduOS AI — AI-native School ERP
echo ======================================================================
echo.
echo Select an option:
echo [1] Start development servers (Backend and Frontend)
echo [2] Install all dependencies (Backend and Frontend)
echo [3] Seed and Migrate Database (Roles, Demo Users, and Demo Data)
echo [4] Build Production bundle and Start
echo [5] Exit
echo.
set /p opt="Enter your choice (1-5): "

if "%opt%"=="1" goto start_dev
if "%opt%"=="2" goto install_deps
if "%opt%"=="3" goto seed_db
if "%opt%"=="4" goto build_prod
if "%opt%"=="5" goto exit

:start_dev
echo.
echo [1/2] Starting Backend on port 5000...
start cmd /k "cd backend && title EduOS Backend && npm run dev"
echo [2/2] Starting Frontend on port 3000...
start cmd /k "cd frontend && title EduOS Frontend && npm run dev"
echo.
echo Backend and Frontend dev servers have been launched in separate windows!
echo - Backend: http://localhost:5000
echo - Swagger Docs: http://localhost:5000/api-docs
echo - Frontend: http://localhost:3000
echo.
pause
goto exit

:install_deps
echo.
echo [1/2] Installing Backend dependencies...
cd backend && call npm install && cd ..
echo [2/2] Installing Frontend dependencies...
cd frontend && call npm install && cd ..
echo.
echo All dependencies installed successfully!
echo.
pause
goto exit

:seed_db
echo.
echo Seeding and migrating database...
cd backend
echo Running: npm run seed
call npm run seed
echo Running: npm run migrate
call npm run migrate
cd ..
echo.
echo Database seeding and migration completed!
echo.
pause
goto exit

:build_prod
echo.
echo Building backend and frontend...
cd backend && call npm run build && cd ..
cd frontend && call npm run build && cd ..
echo.
echo Starting production servers...
start cmd /k "cd backend && title EduOS Backend Production && npm start"
start cmd /k "cd frontend && title EduOS Frontend Production && npm start"
echo.
echo Production servers started!
pause
goto exit

:exit
exit
