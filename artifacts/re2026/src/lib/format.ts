export const formatCurrency = (amount: number | null | undefined, currency: string = "EUR") => {
  if (amount == null) return "—";
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: currency || "EUR",
  }).format(amount);
};

export const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return "—";
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
