FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ARG STAND_GIT_COMMIT
ARG STAND_REPOSITORY
ENV STAND_GIT_COMMIT=$STAND_GIT_COMMIT STAND_REPOSITORY=$STAND_REPOSITORY

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
