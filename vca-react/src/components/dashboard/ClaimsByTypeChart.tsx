import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockClaimsByType } from "@/lib/mock-data";

export type ByTypeDataPoint = { type: string; count: number; percentage?: number };

interface ClaimsByTypeChartProps {
  data?: ByTypeDataPoint[] | null;
}

const COLORS = [
  "rgb(var(--chart-1))",
  "rgb(var(--chart-2))",
  "rgb(var(--chart-3))",
  "rgb(var(--chart-4))",
  "rgb(var(--chart-5))",
];

export function ClaimsByTypeChart({ data }: ClaimsByTypeChartProps) {
  const chartData = (data && data.length > 0) ? data : mockClaimsByType;
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          Claims by Type
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={4}
                dataKey="count"
                nameKey="type"
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                    stroke="transparent"
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgb(var(--card))",
                  border: `1px solid rgb(var(--border))`,
                  borderRadius: "8px",
                  boxShadow: "var(--shadow-md)",
                }}
                labelStyle={{ color: "rgb(var(--foreground))" }}
                formatter={(value: number, name: string) => [
                  `${value} claims`,
                  name,
                ]}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => (
                  <span className="text-sm text-muted-foreground">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}