import { useEffect, useRef, useCallback } from 'react';

interface AutoSaveOptions {
  onSave: () => Promise<void>;
  debounceMs?: number;
}

export function useAutoSave({ onSave, debounceMs = 500 }: AutoSaveOptions) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const pendingRef = useRef(false);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const triggerSave = useCallback(async () => {
    // a change made while a save is running is saved right after it, never dropped
    if (isSavingRef.current) { pendingRef.current = true; return; }

    isSavingRef.current = true;
    try {
      do {
        pendingRef.current = false;
        try {
          await onSaveRef.current();
        } catch (error) {
          console.error('Auto-save failed:', error);
        }
      } while (pendingRef.current);
    } finally {
      isSavingRef.current = false;
    }
  }, []);

  const debouncedSave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      triggerSave();
    }, debounceMs);
  }, [debounceMs, triggerSave]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    save: debouncedSave,
  };
}
