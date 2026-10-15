const pad = (value: number): string => String(value).padStart(2, '0');

/** Room chat time as `YYYY/MM/DD HH:mm` in the viewer's local time zone. */
export function formatChatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
