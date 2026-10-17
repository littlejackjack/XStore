export function formatIdr(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return 'Unlimited';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function statusColor(status: string): string {
  switch (status) {
    case 'ONLINE':
    case 'ACTIVE':
    case 'COMPLETED':
    case 'PAID':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
    case 'MAINTENANCE':
    case 'PROVISIONING':
    case 'PENDING':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
    case 'OFFLINE':
    case 'FAILED':
    case 'EXPIRED':
    case 'CANCELLED':
    case 'DISABLED':
    case 'DEPLETED':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
    default:
      return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300';
  }
}
