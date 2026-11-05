import { useCallback, useState } from 'react';

/** Boolean state that survives reloads. Falls back to memory when storage is blocked. */
export function useStoredBoolean(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === 'true';
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Storage is unavailable, so the value lasts for this session only.
      }
    },
    [key],
  );

  return [value, update] as const;
}
