import { useState, useCallback, useMemo } from 'react';

/**
 * Tracks whether form values have changed from their original state.
 * Provides a `guardedClose` function that intercepts close attempts when dirty.
 *
 * @param currentValues - Current form values
 * @param originalValues - Original form values (null = not editing / not tracked)
 */
export function useUnsavedChanges<T>(
  currentValues: T,
  originalValues: T | null,
) {
  const [showDialog, setShowDialog] = useState(false);
  const [pendingClose, setPendingClose] = useState<(() => void) | null>(null);

  const isDirty = useMemo(
    () =>
      originalValues !== null &&
      JSON.stringify(currentValues) !== JSON.stringify(originalValues),
    [currentValues, originalValues],
  );

  const guardedClose = useCallback(
    (closeAction: () => void) => {
      if (isDirty) {
        setPendingClose(() => closeAction);
        setShowDialog(true);
      } else {
        closeAction();
      }
    },
    [isDirty],
  );

  const handleKeepEditing = useCallback(() => {
    setShowDialog(false);
    setPendingClose(null);
  }, []);

  const handleDiscard = useCallback(() => {
    pendingClose?.();
    setShowDialog(false);
    setPendingClose(null);
  }, [pendingClose]);

  return {
    isDirty,
    showDialog,
    guardedClose,
    handleKeepEditing,
    handleDiscard,
  };
}
