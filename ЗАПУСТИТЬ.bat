@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Запуск стенда сравнения подходов к интеграции ИИ в браузер
echo  ----------------------------------------------------------
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo  Не найден Docker.
  echo  Установите Docker Desktop: https://www.docker.com/products/docker-desktop/
  echo.
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo  Docker установлен, но не запущен.
  echo  Откройте Docker Desktop и дождитесь, пока значок кита перестанет мигать.
  echo.
  pause
  exit /b 1
)

echo  Поднимаю стенд. Первый запуск долгий: качаются образы и языковые
echo  модели, около 3,2 ГБ. Последующие запуски занимают секунды.
echo.

if not defined STAND_GIT_COMMIT for /f %%G in ('git rev-parse HEAD 2^>nul') do set "STAND_GIT_COMMIT=%%G"
git diff --quiet HEAD -- frontend backend 2>nul
if errorlevel 1 set "STAND_GIT_DIRTY=true"
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo  Не удалось поднять стенд. Текст ошибки выше.
  pause
  exit /b 1
)

echo.
set "STAND_PORT=8080"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="FRONTEND_PORT" set "STAND_PORT=%%B"
  )
)
if defined FRONTEND_PORT set "STAND_PORT=%FRONTEND_PORT%"
echo  Готово. Открываю http://localhost:%STAND_PORT%
echo.
echo  Языковые модели для чат-бота могут ещё догружаться.
echo  Посмотреть ход: docker compose logs -f llm-bootstrap
echo.
timeout /t 3 >nul
start "" http://localhost:%STAND_PORT%
pause
