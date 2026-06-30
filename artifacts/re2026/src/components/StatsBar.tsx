import { useGetInvoiceStats } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { FileText, DollarSign, PiggyBank, Receipt } from "lucide-react";

export function StatsBar() {
  const { data: stats, isLoading } = useGetInvoiceStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-card rounded-lg border border-border p-5 h-[104px] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <StatCard 
        title="Anzahl Rechnungen" 
        value={stats?.totalInvoices?.toString() || "0"} 
        icon={<FileText className="h-4 w-4 text-primary" />} 
      />
      <StatCard 
        title="Gesamt Brutto" 
        value={formatCurrency(stats?.totalBrutto)} 
        icon={<DollarSign className="h-4 w-4 text-primary" />} 
      />
      <StatCard 
        title="Gesamt Netto" 
        value={formatCurrency(stats?.totalNetto)} 
        icon={<PiggyBank className="h-4 w-4 text-primary" />} 
      />
      <StatCard 
        title="Gesamt Steuer" 
        value={formatCurrency(stats?.totalSteuer)} 
        icon={<Receipt className="h-4 w-4 text-primary" />} 
      />
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string, value: string, icon: React.ReactNode }) {
  return (
    <div className="bg-card rounded-lg border border-border p-5 flex flex-col justify-between shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold tracking-tight text-foreground font-mono">{value}</div>
    </div>
  );
}
