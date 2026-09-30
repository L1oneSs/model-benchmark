@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Останавливаю стенд. Данные сохранятся: при следующем
echo  запуске все прогоны будут на месте.
echo.
docker compose down
echo.
echo  Готово. Чтобы стереть базу и модели, выполните: docker compose down -v
echo.
pause
