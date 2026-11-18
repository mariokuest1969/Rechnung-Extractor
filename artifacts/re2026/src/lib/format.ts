export const formatCurrency = (amount: number | null | undefined, currency: string = "EUR") => {
  if (amount == null) return "—";
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: currency || "EUR",
  }).format(amount);
};

export const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return "—";
  // Invoice dates are calendar days, not UTC-midnight instants. Never let the
  // viewer's timezone turn a Berlin booking date into the preceding day.
  const calendar = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (calendar) {
    const check = new Date(`${dateStr}T12:00:00Z`);
    if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== dateStr) return dateStr;
    return `${calendar[3]}.${calendar[2]}.${calendar[1]}`;
  }
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat("de-AT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(d);
  } catch (e) {
    return dateStr;
  }
};

export const formatPercent = (val: number | null | undefined) => {
  if (val == null) return "—";
  return `${val}%`;
};

export const formatNumber = (val: number | null | undefined) => {
  if (val == null) return "—";
  return new Intl.NumberFormat("de-AT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
};
