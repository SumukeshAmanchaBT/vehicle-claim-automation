import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Zap, TrendingUp, Target } from "lucide-react";
import { mockDashboardStats } from "@/lib/mock-data";

interface AutomationStatsProps {
  stpRate?: number;
  automationRate?: number;
  avgProcessingTime?: string;
}

export function AutomationStats({
  stpRate = mockDashboardStats.stpRate,
  automationRate = mockDashboardStats.automationRate,
  avgProcessingTime = mockDashboardStats.avgProcessingTime,
}: AutomationStatsProps) {
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <CardTitle className="text-base font-semibold">
            Automation Performance
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">STP Rate</span>
            <span className="font-semibold">{stpRate}%</span>
          </div>
          <Progress value={stpRate} className="h-2" />
          <p className="text-xs text-muted-foreground">
            Straight-Through Processing without manual intervention
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
              <span className="text-xs">Automation Rate</span>
            </div>
            <p className="text-xl font-bold">
              {automationRate}%
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="text-xs">Avg. Time</span>
            </div>
            <p className="text-xl font-bold">
              {avgProcessingTime}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-success/10 p-3 mt-2">
          <Target className="h-4 w-4 text-success" />
          <span className="text-sm text-success font-medium">
            Target: 24-48 hr settlement for simple claims
          </span>
        </div>
      </CardContent>
    </Card>
  );
}