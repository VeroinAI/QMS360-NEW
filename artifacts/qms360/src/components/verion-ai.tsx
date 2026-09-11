import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

const VERION_TEXT = "text-[#b52865] dark:text-[#f472b6]";
const VERION_BG = "bg-[#fceaf3] dark:bg-[#b52865]/20";
const VERION_BORDER = "border-[#b52865]/20";

export function VerionIcon({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", VERION_BG, VERION_TEXT, className)}>
      <Sparkles className="h-4 w-4" strokeWidth={2.5} />
    </div>
  );
}

export function VerionWordmark({ className, suffix }: { className?: string; suffix?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 font-bold tracking-tight text-lg", className)}>
      <span className={VERION_TEXT}>Verion</span>
      <span className={cn("flex gap-0.5 opacity-80", VERION_TEXT)}>
        <span className="h-4 w-0.5 rounded-full bg-current"></span>
        <span className="h-4 w-0.5 rounded-full bg-current"></span>
      </span>
      {suffix && <span className="text-foreground">{suffix}</span>}
    </div>
  );
}

export function VerionBadge({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold", VERION_BG, VERION_BORDER, VERION_TEXT, className)}>
      <Sparkles className="h-3 w-3" />
      <span>{children ?? "VerionAI"}</span>
    </div>
  );
}

export function VerionCard({ className, children, title, action }: { className?: string; children: ReactNode; title?: string | ReactNode; action?: ReactNode }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm", VERION_BORDER, className)}>
      <div className={cn("flex items-center justify-between border-b px-4 py-3", VERION_BORDER, VERION_BG)}>
        <div className="flex items-center gap-3">
          <VerionIcon className="h-6 w-6 rounded-lg [&>svg]:h-3 [&>svg]:w-3" />
          {title ? (typeof title === 'string' ? <span className="font-semibold text-foreground">{title}</span> : title) : <VerionWordmark className="text-base" />}
        </div>
        {action}
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}
