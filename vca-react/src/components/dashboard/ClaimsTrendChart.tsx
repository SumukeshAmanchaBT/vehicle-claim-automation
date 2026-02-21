import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockClaimsTrend } from "@/lib/mock-data";

export type TrendDataPoint = { date: string; claims: number; approved: number };

interface ClaimsTrendChartProps {
  data?: TrendDataPoint[] | null;
}

export function ClaimsTrendChart({ data }: ClaimsTrendChartProps) {
  const chartData = (data && data.length > 0) ? data : mockClaimsTrend;
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Claims Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorClaims" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="rgb(var(--chart-1))"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="rgb(var(--chart-1))"
                    stopOpacity={0}
                  />
                </linearGradient>
                <linearGradient id="colorApproved" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="rgb(var(--chart-2))"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="rgb(var(--chart-2))"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgb(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgb(var(--card))",
                  border: `1px solid rgb(var(--border))`,
                  borderRadius: "8px",
                  boxShadow: "var(--shadow-md)",
                }}
                labelStyle={{ color: "rgb(var(--foreground))" }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="claims"
                name="Total Claims"
                stroke="rgb(var(--chart-1))"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorClaims)"
              />
              <Area
                type="monotone"
                dataKey="approved"
                name="Approved"
                stroke="rgb(var(--chart-2))"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorApproved)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}