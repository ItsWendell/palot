export function notifyEventObservers<T>(
  observers: Iterable<(value: T) => void>,
  value: T,
  onError: (error: unknown) => void,
): void {
  for (const observer of observers) {
    try {
      observer(value);
    } catch (error) {
      onError(error);
    }
  }
}
