import { useEffect, useRef, useCallback } from 'react';

interface AutoSaveOptions {
  onSave: () => Promise<void>;
  debounceMs?: number;
}

export function useAutoSave({ onSave, debounceMs = 500 }: AutoSaveOptions) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const triggerSave = useCallback(async () => {
    if (isSavingRef.current) return;

    isSavingRef.current = true;
    try {
      await onSaveRef.current();
    } catch (error) {
      console.error('Auto-save failed:', error);
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
