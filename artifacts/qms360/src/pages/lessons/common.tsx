import type { ReactNode } from "react";
import { Link } from "wouter";
import { AlertCircle, ArrowLeft, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { lessonLoadError } from "./load-error";

export function PageHeader({ title, description, actions, back }: { title: string; description?: string; actions?: ReactNode; back?: string }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        {back && <Button variant="ghost" size="sm" asChild className="-ml-3 mb-2"><Link href={back}><ArrowLeft /> Back</Link></Button>}
        <h1 className="font-serif text-3xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StateBadge({ state }: { state: string }) {
  const variant = state === "Approved" ? "default" : state === "Submitted" ? "secondary" : state === "Sent Back" ? "destructive" : "outline";
  return <Badge variant={variant}>{state}</Badge>;
}

export function LoadState({ loading, error, empty, children, resource }: { loading: boolean; error: unknown; empty: boolean; children: ReactNode; resource?: string }) {
  if (loading) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (error) {
    const message = lessonLoadError(error, resource);
    return <Card><CardContent role="alert" className="flex items-start gap-3 py-10 text-destructive"><AlertCircle className="mt-0.5 shrink-0" aria-hidden="true" /><div><p className="font-semibold">{message.title}</p><p className="mt-1 text-sm">{message.description}</p></div></CardContent></Card>;
  }
  if (empty) return <Card><CardContent className="flex flex-col items-center py-12 text-center"><BookOpen className="mb-3 size-9 text-muted-foreground" /><p className="font-semibold">No lessons found</p><p className="text-sm text-muted-foreground">Try changing the filters or create a new lesson.</p></CardContent></Card>;
  return <>{children}</>;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}