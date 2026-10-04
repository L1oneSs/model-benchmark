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
  rem skipped pause for test
  exit /b 1
)

call docker.cmd info >nul 2>nul
if errorlevel 1 (
  echo  Docker установлен, но не запущен.
  echo  Откройте Docker Desktop и дождитесь, пока значок кита перестанет мигать.
  echo.
  rem skipped pause for test
  exit /b 1
)

echo  Поднимаю стенд. Первый запуск долгий: качаются образы и языковые
echo  модели, около 3,2 ГБ. Последующие запуски занимают секунды.
echo.

call docker.cmd compose up -d --build
if errorlevel 1 (
  echo.
  echo  Не удалось поднять стенд. Текст ошибки выше.
  rem skipped pause for test
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
rem skipped delay for test
echo TEST_BROWSER_URL=http://localhost:%STAND_PORT%
rem skipped pause for test

exit /b 0
