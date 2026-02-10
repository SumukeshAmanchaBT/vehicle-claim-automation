import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/components/ui/use-toast";
import { Plus, Edit2, Trash2, Settings2 } from "lucide-react";
import {
  createDamageCode,
  deleteDamageCode,
  getClaimRules,
  getClaimTypes,
  getDamageCodes,
  type ClaimRuleMaster,
  type ClaimTypeMaster,
  type DamageCodeMaster,
} from "@/lib/api";

export default function MasterData() {
  const { toast } = useToast();

  const [damageTypes, setDamageTypes] = useState<DamageCodeMaster[]>([]);
  const [claimTypes, setClaimTypes] = useState<ClaimTypeMaster[]>([]);
  const [claimRules, setClaimRules] = useState<ClaimRuleMaster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMasterData() {
      try {
        const [damage, types, rules] = await Promise.all([
          getDamageCodes(),
          getClaimTypes(),
          getClaimRules(),
        ]);
        setDamageTypes(damage);
        setClaimTypes(types);
        setClaimRules(rules);
      } catch (error) {
        console.error(error);
        toast({
          title: "Error loading master data",
          description: "Please check API connectivity and try again.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }

    loadMasterData();
  }, [toast]);

  const handleAddDamageType = async () => {
    const name = window.prompt("Damage type name (e.g. bumper):");
    if (!name) return;
    const severityStr = window.prompt(
      "Severity percentage (0-100, e.g. 20):",
      "20",
    );
    const severity = severityStr ? Number(severityStr) : NaN;
    if (Number.isNaN(severity)) {
      toast({
        title: "Invalid severity",
        description: "Please enter a numeric value.",
        variant: "destructive",
      });
      return;
    }

    try {
      const created = await createDamageCode({
        damage_type: name,
        severity_percentage: severity,
        is_active: true,
      });
      setDamageTypes((prev) => [...prev, created]);
      toast({ title: "Damage type created" });
    } catch (error) {
      console.error(error);
      toast({
        title: "Failed to create damage type",
        variant: "destructive",
      });
    }
  };

  const handleDeleteDamageType = async (id: number) => {
    if (!window.confirm("Delete this damage type?")) return;
    try {
      await deleteDamageCode(id);
      setDamageTypes((prev) => prev.filter((d) => d.damage_id !== id));
      toast({ title: "Damage type deleted" });
    } catch (error) {
      console.error(error);
      toast({
        title: "Failed to delete damage type",
        variant: "destructive",
      });
    }
  };

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
                <Button size="sm" onClick={handleAddDamageType}>
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
                    {loading ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={5}>
                          Loading damage types...
                        </TableCell>
                      </TableRow>
                    ) : damageTypes.length === 0 ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={5}>
                          No damage types configured yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      damageTypes.map((type) => (
                        <TableRow key={type.damage_id} className="group">
                          <TableCell className="pl-6 font-medium">
                            {type.damage_type}
                          </TableCell>
                          <TableCell>{type.severity_percentage}</TableCell>
                          <TableCell>-</TableCell>
                          <TableCell>
                            <Switch checked={type.is_active} disabled />
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon">
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  handleDeleteDamageType(type.damage_id)
                                }
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="thresholds">
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base">Claim Type Thresholds</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-6">Claim Type</TableHead>
                      <TableHead>Risk Percentage (%)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-6 text-right">Created At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={4}>
                          Loading claim types...
                        </TableCell>
                      </TableRow>
                    ) : claimTypes.length === 0 ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={4}>
                          No claim types configured.
                        </TableCell>
                      </TableRow>
                    ) : (
                      claimTypes.map((type) => (
                        <TableRow key={type.claim_type_id}>
                          <TableCell className="pl-6 font-medium">
                            {type.claim_type_name}
                          </TableCell>
                          <TableCell>{type.risk_percentage}</TableCell>
                          <TableCell>
                            <Switch checked={type.is_active} disabled />
                          </TableCell>
                          <TableCell className="pr-6 text-right text-xs text-muted-foreground">
                            {new Date(type.created_date).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fraud-rules">
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base">Fraud Rules</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-6">Rule Type</TableHead>
                      <TableHead>Rule Group</TableHead>
                      <TableHead>Expression</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={4}>
                          Loading fraud rules...
                        </TableCell>
                      </TableRow>
                    ) : claimRules.length === 0 ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={4}>
                          No fraud rules configured.
                        </TableCell>
                      </TableRow>
                    ) : (
                      claimRules.map((rule) => (
                        <TableRow key={rule.rule_id}>
                          <TableCell className="pl-6 font-medium">
                            {rule.rule_type}
                          </TableCell>
                          <TableCell>{rule.rule_group}</TableCell>
                          <TableCell className="max-w-md truncate">
                            {rule.rule_expression}
                          </TableCell>
                          <TableCell>
                            <Switch checked={rule.is_active} disabled />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
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