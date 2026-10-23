import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function PlanSelection<T extends string>({ id, number, label, options, value, onChange, disabled, required, error }: {
  id: string; number: number; label: string; options: readonly T[]; value: T[];
  onChange: (value: T[]) => void; disabled: boolean; required: boolean; error?: string;
}) {
  return <div>
    <Label htmlFor={id}>{number}. {label}{required ? " *" : ""}</Label>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id={id} type="button" variant="outline" disabled={disabled}
          aria-label={label} aria-required={required} aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-2 h-auto min-h-9 w-full justify-between whitespace-normal text-left font-normal">
          <span className="min-w-0 break-words">{value.length ? value.join(", ") : `Select ${label}`}</span>
          <ChevronDown className="ml-2 size-4 shrink-0"/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-1rem)] overflow-y-auto">
        {options.map(option => <DropdownMenuCheckboxItem key={option} checked={value.includes(option)}
          className="whitespace-normal break-words" onSelect={event => event.preventDefault()}
          onCheckedChange={checked => onChange(checked
            ? [...new Set([...value, option])] : value.filter(item => item !== option))}>
          {option}
        </DropdownMenuCheckboxItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
  </div>;
}
