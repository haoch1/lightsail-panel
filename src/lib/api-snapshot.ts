export type ApiSnapshot<T> = {
  path: string | null;
  retainKey?: string;
  dataPath?: string;
  data?: T;
  error: string;
  loading: boolean;
};

/** Keep results only within an explicitly shared resource identity. */
export function nextSnapshot<T>(
  current: ApiSnapshot<T>,
  path: string | null,
  retainKey: string | undefined,
  cached?: T,
): ApiSnapshot<T> {
  if (!path) return { path, retainKey, error: "", loading: false };
  if (cached !== undefined)
    return {
      path,
      retainKey,
      dataPath: path,
      data: cached,
      error: "",
      loading: false,
    };
  const canRetain =
    retainKey === current.retainKey &&
    (current.path === path || retainKey !== undefined);
  return {
    path,
    retainKey,
    dataPath: canRetain ? current.dataPath : undefined,
    data: canRetain ? current.data : undefined,
    error: "",
    loading: true,
  };
}
