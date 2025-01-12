export const env = {}

export const nextTick = (fn: (...args: any[]) => void, ...args: any[]) => {
  queueMicrotask(() => fn(...args));
}
