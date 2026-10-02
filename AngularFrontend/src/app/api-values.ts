export type ApiId = string | { $oid: string };
export type ApiDate = string | { $date: string | { $numberLong: string } } | null;
export const readId = (id: ApiId): string => typeof id === 'string' ? id : id.$oid;
export function readDate(date: ApiDate): number | null {
  if (date == null) return null;
  const value = typeof date === 'string' ? date : date.$date;
  const timestamp = typeof value === 'string' ? Date.parse(value) : Number(value.$numberLong);
  return Number.isFinite(timestamp) ? timestamp : null;
}
