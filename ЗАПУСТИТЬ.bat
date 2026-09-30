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

docker compose up -d --build
if errorlevel 1 (
  echo.
  echo  Не удалось поднять стенд. Текст ошибки выше.
  pause
  exit /b 1
)

echo.
echo  Готово. Открываю http://localhost:8080
echo.
echo  Языковые модели для чат-бота могут ещё догружаться.
echo  Посмотреть ход: docker compose logs -f llm-bootstrap
echo.
timeout /t 3 >nul
start "" http://localhost:8080
pause
