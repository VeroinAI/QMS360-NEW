import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Option = { id: string; name: string };
export function ActivityMultiSelect({ label, options, value, onChange, disabled = false, historicalOptions = [] }: {
  label: string; options: Option[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; historicalOptions?: Option[];
}) {
  const missing = value.filter(id => !options.some(option => option.id === id));
  const toggle = (id: string, checked: boolean) => onChange(checked ? [...new Set([...value, id])] : value.filter(item => item !== id));
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button type="button" variant="outline" disabled={disabled} aria-label={label} className="h-auto min-h-10 w-full justify-start whitespace-normal text-left font-normal">
      {value.length ? value.map(id => options.find(option => option.id === id)?.name ?? historicalOptions.find(option => option.id === id)?.name ?? `Unavailable selection (${id})`).join(", ") : label}
    </Button>
  </DropdownMenuTrigger><DropdownMenuContent searchable className="max-h-72 max-w-[min(28rem,calc(100vw-1rem))] overflow-y-auto">
    {options.map(option => <DropdownMenuCheckboxItem key={option.id} checked={value.includes(option.id)}
      onSelect={event => event.preventDefault()} onCheckedChange={checked => toggle(option.id, checked === true)}>{option.name}</DropdownMenuCheckboxItem>)}
    {missing.map(id => <DropdownMenuCheckboxItem key={id} checked onCheckedChange={() => toggle(id, false)}
      onSelect={event => event.preventDefault()}>{historicalOptions.find(option => option.id === id)?.name
        ? `${historicalOptions.find(option => option.id === id)!.name} — unavailable, remove`
        : `Unavailable selection — remove (${id})`}</DropdownMenuCheckboxItem>)}
    {!options.length && <p className="px-2 py-1 text-sm text-muted-foreground">No available options.</p>}
  </DropdownMenuContent></DropdownMenu>;
}
