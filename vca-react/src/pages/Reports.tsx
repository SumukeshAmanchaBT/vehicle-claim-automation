import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { Download, Calendar, TrendingUp, DollarSign, Clock, Target } from "lucide-react";

const monthlyData = [
  { month: "Sep", claims: 245, approved: 198, rejected: 32, settlements: 485000 },
  { month: "Oct", claims: 278, approved: 225, rejected: 38, settlements: 542000 },
  { month: "Nov", claims: 312, approved: 258, rejected: 41, settlements: 628000 },
  { month: "Dec", claims: 289, approved: 234, rejected: 39, settlements: 578000 },
  { month: "Jan", claims: 356, approved: 298, rejected: 45, settlements: 712000 },
  { month: "Feb", claims: 198, approved: 165, rejected: 22, settlements: 389000 },
];

const processingTimeData = [
  { week: "W1", manual: 72, automated: 4 },
  { week: "W2", manual: 68, automated: 3.8 },
  { week: "W3", manual: 65, automated: 4.2 },
  { week: "W4", manual: 62, automated: 3.5 },
  { week: "W5", manual: 58, automated: 3.2 },
  { week: "W6", manual: 55, automated: 3.0 },
];

export default function Reports() {
  return (
    <AppLayout
      title="Reports & Analytics"
      subtitle="Claims performance metrics and insights"
    >
      <div className="space-y-6 animate-fade-in">
        {/* Filters */}
        <Card className="card-elevated">
          <CardContent className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Select defaultValue="6m">
                  <SelectTrigger className="w-[180px]">
                    <Calendar className="mr-2 h-4 w-4" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">Last 7 Days</SelectItem>
                    <SelectItem value="30d">Last 30 Days</SelectItem>
                    <SelectItem value="3m">Last 3 Months</SelectItem>
                    <SelectItem value="6m">Last 6 Months</SelectItem>
                    <SelectItem value="1y">Last Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Export Report
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="card-elevated">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Claims</p>
                  <p className="text-2xl font-bold">1,678</p>
                  <p className="text-xs text-success">+12% vs last period</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="card-elevated">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                  <Target className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Automation Rate</p>
                  <p className="text-2xl font-bold">72%</p>
                  <p className="text-xs text-success">+5% improvement</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="card-elevated">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10">
                  <Clock className="h-5 w-5 text-info" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Avg. Process Time</p>
                  <p className="text-2xl font-bold">4.2 hrs</p>
                  <p className="text-xs text-success">-18% faster</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="card-elevated">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                  <DollarSign className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Settlements</p>
                  <p className="text-2xl font-bold">$3.3M</p>
                  <p className="text-xs text-muted-foreground">Last 6 months</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Claims Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgb(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="month"
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
                      }}
                    />
                    <Legend />
                    <Bar
                      dataKey="approved"
                      name="Approved"
                      fill="rgb(var(--chart-2))"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="rejected"
                      name="Rejected"
                      fill="rgb(var(--chart-5))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Processing Time (Hours)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={processingTimeData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgb(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="week"
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
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="manual"
                      name="Manual Processing"
                      stroke="rgb(var(--chart-3))"
                      strokeWidth={2}
                      dot={{ fill: "rgb(var(--chart-3))" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="automated"
                      name="Automated (STP)"
                      stroke="rgb(var(--chart-2))"
                      strokeWidth={2}
                      dot={{ fill: "rgb(var(--chart-2))" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Settlement Summary */}
        <Card className="card-elevated">
          <CardHeader>
            <CardTitle className="text-base">Monthly Settlement Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgb(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "rgb(var(--muted-foreground))", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgb(var(--card))",
                      border: `1px solid rgb(var(--border))`,
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => [`$${value.toLocaleString()}`, "Settlements"]}
                  />
                    <Bar
                      dataKey="settlements"
                      name="Settlement Amount"
                      fill="rgb(var(--chart-1))"
                      radius={[4, 4, 0, 0]}
                    />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}