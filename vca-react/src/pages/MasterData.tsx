import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Slider } from "@/components/ui/slider";
import { Plus, Edit2, Trash2, Save, Settings2 } from "lucide-react";

const damageTypes = [
  { id: "1", name: "Dent", baseCost: 250, maxCost: 1500, active: true },
  { id: "2", name: "Scratch", baseCost: 150, maxCost: 800, active: true },
  { id: "3", name: "Glass/Windshield", baseCost: 400, maxCost: 1200, active: true },
  { id: "4", name: "Structural", baseCost: 2000, maxCost: 15000, active: true },
  { id: "5", name: "Bumper", baseCost: 500, maxCost: 2500, active: true },
  { id: "6", name: "Hood", baseCost: 800, maxCost: 3000, active: true },
  { id: "7", name: "Door Panel", baseCost: 600, maxCost: 2000, active: true },
  { id: "8", name: "Tail Light", baseCost: 200, maxCost: 600, active: true },
];

const thresholds = {
  simpleClaimMax: 5000,
  aiConfidenceMin: 85,
  fraudScoreMax: 30,
  earlyClaimDays: 30,
};

export default function MasterData() {
  return (
    <AppLayout
      title="Master Data"
      subtitle="Configure damage types, thresholds, and automation rules"
    >
      <div className="space-y-6 animate-fade-in">
        <Tabs defaultValue="damage-types" className="space-y-4">
          <TabsList>
            <TabsTrigger value="damage-types">Damage Types</TabsTrigger>
            <TabsTrigger value="thresholds">Claim Thresholds</TabsTrigger>
            <TabsTrigger value="fraud-rules">Fraud Rules</TabsTrigger>
            <TabsTrigger value="automation">Automation Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="damage-types">
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Damage Type Configuration</CardTitle>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Damage Type
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-6">Damage Type</TableHead>
                      <TableHead>Base Cost ($)</TableHead>
                      <TableHead>Max Cost ($)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {damageTypes.map((type) => (
                      <TableRow key={type.id} className="group">
                        <TableCell className="pl-6 font-medium">
                          {type.name}
                        </TableCell>
                        <TableCell>${type.baseCost.toLocaleString()}</TableCell>
                        <TableCell>${type.maxCost.toLocaleString()}</TableCell>
                        <TableCell>
                          <Switch checked={type.active} />
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon">
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="thresholds">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="card-elevated">
                <CardHeader>
                  <CardTitle className="text-base">Simple Claim Criteria</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Maximum Claim Value for Simple Processing</Label>
                      <span className="text-sm font-medium">${thresholds.simpleClaimMax.toLocaleString()}</span>
                    </div>
                    <Slider
                      defaultValue={[thresholds.simpleClaimMax]}
                      max={20000}
                      step={500}
                    />
                    <p className="text-xs text-muted-foreground">
                      Claims below this value may qualify for straight-through processing
                    </p>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Minimum AI Confidence for Auto-Approval</Label>
                      <span className="text-sm font-medium">{thresholds.aiConfidenceMin}%</span>
                    </div>
                    <Slider
                      defaultValue={[thresholds.aiConfidenceMin]}
                      max={100}
                      step={1}
                    />
                    <p className="text-xs text-muted-foreground">
                      AI assessment must exceed this confidence level
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Maximum Fraud Score for Auto-Approval</Label>
                      <span className="text-sm font-medium">{thresholds.fraudScoreMax}%</span>
                    </div>
                    <Slider
                      defaultValue={[thresholds.fraudScoreMax]}
                      max={100}
                      step={1}
                    />
                    <p className="text-xs text-muted-foreground">
                      Claims with higher fraud scores require manual review
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="card-elevated">
                <CardHeader>
                  <CardTitle className="text-base">OIC Excess Rules</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="standard-excess">Standard Deductible</Label>
                    <Input id="standard-excess" defaultValue="500" type="number" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="glass-excess">Glass Damage Deductible</Label>
                    <Input id="glass-excess" defaultValue="100" type="number" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theft-excess">Theft Deductible</Label>
                    <Input id="theft-excess" defaultValue="1000" type="number" />
                  </div>
                  <div className="pt-2">
                    <Button className="w-full">
                      <Save className="mr-2 h-4 w-4" />
                      Save Changes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="fraud-rules">
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base">Fraud Detection Rules</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Early Claim Detection</p>
                        <p className="text-sm text-muted-foreground">
                          Flag claims filed within {thresholds.earlyClaimDays} days of policy start
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Location Mismatch</p>
                        <p className="text-sm text-muted-foreground">
                          Flag when incident location differs from usual routes
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Repeat Repair Shop</p>
                        <p className="text-sm text-muted-foreground">
                          Flag repeated use of same repair shop
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Blacklist Check</p>
                        <p className="text-sm text-muted-foreground">
                          Check against known fraud databases
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Duplicate Claims</p>
                        <p className="text-sm text-muted-foreground">
                          Detect potential duplicate claim submissions
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Image Tampering Detection</p>
                        <p className="text-sm text-muted-foreground">
                          AI-based detection of manipulated photos
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="automation">
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Automation Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Auto-Approve Simple Claims</p>
                        <p className="text-sm text-muted-foreground">
                          Automatically approve claims meeting all STP criteria
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Auto-Assign to Adjusters</p>
                        <p className="text-sm text-muted-foreground">
                          Automatically assign complex claims to available adjusters
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Send Settlement Notifications</p>
                        <p className="text-sm text-muted-foreground">
                          Automatically notify customers of settlement decisions
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Sync with Guidewire</p>
                        <p className="text-sm text-muted-foreground">
                          Push approved claims back to core system
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Auto-Escalate High Risk</p>
                        <p className="text-sm text-muted-foreground">
                          Escalate high fraud risk claims to supervisor
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">Document Request Automation</p>
                        <p className="text-sm text-muted-foreground">
                          Auto-request missing documents from claimants
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}