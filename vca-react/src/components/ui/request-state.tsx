import { useEffect, useState } from "react";
import { AlertCircle, Clock3, Loader2, RefreshCcw, ServerCrash } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ApiErrorSummary } from "@/lib/httpClient";

function useElapsedMs(active: boolean) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }

    const startedAt = performance.now();
    const update = () => {
      setElapsedMs(Math.round(performance.now() - startedAt));
    };

    update();
    const intervalId = window.setInterval(update, 250);
    return () => window.clearInterval(intervalId);
  }, [active]);

  return elapsedMs;
}

function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

function getLoadingMessage(elapsedMs: number) {
  if (elapsedMs >= 15_000) {
    return "This is taking longer than usual. The app is still waiting for the backend response.";
  }
  if (elapsedMs >= 6_000) {
    return "Still working. Larger MySQL result sets and cold connections can take a little longer.";
  }
  return "Fetching the latest data from the backend service.";
}

export function ApiLoadingState({
  title,
  description,
  timeoutMs,
}: {
  title: string;
  description?: string;
  timeoutMs: number;
}) {
  const elapsedMs = useElapsedMs(true);
  const progressValue = Math.min(95, Math.round((elapsedMs / timeoutMs) * 100));

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-14 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
        <div className="space-y-2">
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="max-w-xl text-sm text-muted-foreground">
            {description || getLoadingMessage(elapsedMs)}
          </p>
        </div>
        <div className="w-full max-w-md space-y-2">
          <Progress value={progressValue} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              Elapsed {formatSeconds(elapsedMs)}
            </span>
            <span>Timeout {formatSeconds(timeoutMs)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ApiErrorState({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: ApiErrorSummary;
  onRetry?: () => void;
}) {
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="space-y-4 py-8">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            {error.isTimeout ? (
              <Clock3 className="h-5 w-5 text-destructive" />
            ) : error.statusCode && error.statusCode >= 500 ? (
              <ServerCrash className="h-5 w-5 text-destructive" />
            ) : (
              <AlertCircle className="h-5 w-5 text-destructive" />
            )}
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-destructive">{error.userMessage}</p>
            <p className="text-sm text-muted-foreground">
              If this keeps happening, use the request ID below to trace the server logs quickly.
            </p>
          </div>
        </div>

        <Accordion type="single" collapsible className="rounded-md border bg-background/80 px-3">
          <AccordionItem value="dev" className="border-0">
            <AccordionTrigger className="py-3 text-sm font-medium text-foreground hover:no-underline">
              Show developer details
            </AccordionTrigger>
            <AccordionContent className="pb-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Developer details</p>
              <p className="mt-2 break-words">
                {error.developerMessage || "No additional diagnostics were provided."}
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {onRetry ? (
          <div className="flex justify-end">
            <Button onClick={onRetry} variant="outline">
              <RefreshCcw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
