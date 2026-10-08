/** OS family first; newest numbered versions first within each family. */
export function compareImages(a: { id: string }, b: { id: string }) {
  const rank = (id: string) =>
    /^debian/i.test(id) ? 0 : /^ubuntu/i.test(id) ? 1 : 2;
  return (
    rank(a.id) - rank(b.id) || b.id.localeCompare(a.id, "en", { numeric: true })
  );
}
