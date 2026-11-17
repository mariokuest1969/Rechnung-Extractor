import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export function ArticleSupplierSelect({ options, value, onChange }: {
  options: readonly { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find(option => option.key === value);
  const label = value ? selected?.label ?? "Lieferant nicht mehr verfügbar" : "Alle Lieferanten";
  const choices = [{ key: "", label: "Alle Lieferanten" }, ...options];
  const visible = choices.filter(option => option.label.toLocaleLowerCase("de").includes(search.trim().toLocaleLowerCase("de")));
  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button id="art-supplier" type="button" variant="outline"
          className="h-8 w-full justify-between px-2 text-sm font-normal"
          data-testid="select-article-supplier">
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command label="Lieferanten suchen" shouldFilter={false} loop>
          <CommandInput aria-label="Lieferanten suchen" placeholder="Lieferanten suchen …"
            value={search} onValueChange={setSearch} />
          <CommandList aria-label="Lieferanten" className="max-h-[min(300px,var(--radix-popover-content-available-height))]">
            <CommandEmpty>Keine Lieferanten gefunden.</CommandEmpty>
            {visible.map(option => (
              <CommandItem key={option.key} value={option.key || "all"} onSelect={() => {
                onChange(option.key);
                setOpen(false);
                setSearch("");
              }}>
                <Check aria-hidden="true" className={value === option.key ? "opacity-100" : "opacity-0"} />
                <span className="break-words">{option.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
