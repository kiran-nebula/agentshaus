export function timeAgo(date: string | number): string {
  const now = Date.now();
  const then = typeof date === 'string' ? new Date(date).getTime() : date;
  const diffMs = now - then;
  if (diffMs < 0) return 'JUST NOW';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} DAY${days > 1 ? 'S' : ''} AGO`;
  if (hours > 0) return `${hours} HOUR${hours > 1 ? 'S' : ''} AGO`;
  if (minutes > 0) return `${minutes} MINUTE${minutes > 1 ? 'S' : ''} AGO`;
  return 'JUST NOW';
}

export function formatCountdown(targetDate: string | number): string {
  const now = Date.now();
  const target = typeof targetDate === 'string' ? new Date(targetDate).getTime() : targetDate;
  const diffMs = target - now;
  if (diffMs <= 0) return '00:00:00';

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}

export function formatRunDate(date: string | number): string {
  const d = new Date(typeof date === 'string' ? date : date);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${month} ${day}, ${year} AT ${displayHour}:${minutes}${ampm}`;
}
