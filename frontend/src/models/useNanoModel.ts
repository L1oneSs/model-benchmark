import { useEffect, useRef, useState } from 'react';

import { availabilityHint, checkAvailability, downloadModel } from './geminiNano';

/** Наблюдение за моделью начинается при открытии стенда, включая уже идущую загрузку. */
export function useNanoModel() {
  const [status, setStatus] = useState('Проверяю доступность');
  const [available, setAvailable] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const startRef = useRef<() => void>(() => {});

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let pending = false;
    let checking = false;
    let attempted = false;
    let waitingForGesture = false;
    let failed = false;
    let lastProgressAt = 0;
    let lastLoaded = -1;

    const start = async () => {
      if (!active || pending) return;
      pending = true;
      attempted = true;
      waitingForGesture = false;
      failed = false;
      lastLoaded = -1;
      lastProgressAt = Date.now();
      setDownloading(true);
      setProgress(null);
      setStatus('Ожидаю сведения о загрузке Gemini Nano от Chrome…');
      try {
        const state = await downloadModel(({ loaded }) => {
          if (!active) return;
          if (loaded > lastLoaded) lastProgressAt = Date.now();
          lastLoaded = Math.max(lastLoaded, loaded);
          const percent = lastLoaded * 100;
          setProgress(percent);
          setStatus(percent >= 100
            ? 'Загружено 100%. Chrome подготавливает модель…'
            : `Загрузка Gemini Nano: ${percent.toFixed(1)}%`);
        }, controller.signal);
        if (!active) return;
        setAvailable(state === 'available');
        setStatus(availabilityHint(state));
        setProgress(state === 'available' ? 100 : null);
      } catch (error) {
        if (!active) return;
        if (error instanceof Error && error.name === 'NotAllowedError') {
          waitingForGesture = true;
          setStatus('Для загрузки Gemini Nano нажмите в любом месте страницы или любую клавишу');
        } else {
          failed = true;
          const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          setStatus(`Ошибка загрузки: ${message}`);
        }
      } finally {
        pending = false;
        if (active) setDownloading(false);
      }
    };

    startRef.current = () => { void start(); };
    const onGesture = (event: Event) => {
      if (event.isTrusted && waitingForGesture) void start();
    };
    document.addEventListener('click', onGesture);
    document.addEventListener('keydown', onGesture);

    const refresh = async () => {
      if (pending) {
        if (Date.now() - lastProgressAt >= 60_000) {
          const detail = lastLoaded < 0 ? '' : ` (${(lastLoaded * 100).toFixed(1)}%)`;
          setStatus(`Chrome не обновляет прогресс больше минуты${detail}. Ожидание продолжается; диагностика: chrome://on-device-internals`);
        }
        return;
      }
      if (checking) return;
      checking = true;
      try {
        const state = await checkAvailability();
        if (!active || pending) return;
        setAvailable(state === 'available');
        if (state === 'available') {
          failed = false;
          waitingForGesture = false;
          setProgress(100);
          setStatus(availabilityHint(state));
        } else if (!attempted && (state === 'downloadable' || state === 'downloading')) {
          void start();
        } else if (!failed && !waitingForGesture) {
          setStatus(availabilityHint(state));
        }
      } finally {
        checking = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('click', onGesture);
      document.removeEventListener('keydown', onGesture);
      startRef.current = () => {};
    };
  }, []);

  return { status, available, downloading, progress, start: () => startRef.current() };
}
