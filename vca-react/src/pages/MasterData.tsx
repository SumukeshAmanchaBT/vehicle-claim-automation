import { useEffect, useState } from "react";
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
import { useToast } from "@/components/ui/use-toast";
import { Plus, Edit2, Trash2, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createDamageCode,
  updateDamageCode,
  deleteDamageCode,
  createClaimType,
  updateClaimType,
  deleteClaimType,
  createClaimRule,
  updateClaimRule,
  deleteClaimRule,
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

  const [damageDialogOpen, setDamageDialogOpen] = useState(false);
  const [newDamageName, setNewDamageName] = useState("");
  const [newDamageSeverity, setNewDamageSeverity] = useState("");
  const [damageEditDialogOpen, setDamageEditDialogOpen] = useState(false);
  const [editingDamage, setEditingDamage] = useState<DamageCodeMaster | null>(null);
  const [editDamageName, setEditDamageName] = useState("");
  const [editDamageSeverity, setEditDamageSeverity] = useState("");

  const [claimTypeDialogOpen, setClaimTypeDialogOpen] = useState(false);
  const [newClaimTypeName, setNewClaimTypeName] = useState("");
  const [newClaimTypeRisk, setNewClaimTypeRisk] = useState("");
  const [claimTypeEditDialogOpen, setClaimTypeEditDialogOpen] = useState(false);
  const [editingClaimType, setEditingClaimType] = useState<ClaimTypeMaster | null>(null);
  const [editClaimTypeName, setEditClaimTypeName] = useState("");
  const [editClaimTypeRisk, setEditClaimTypeRisk] = useState("");

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [newRuleType, setNewRuleType] = useState("");
  const [newRuleGroup, setNewRuleGroup] = useState("");
  const [newRuleDescription, setNewRuleDescription] = useState("");
  const [newRuleExpression, setNewRuleExpression] = useState("");
  const [ruleEditDialogOpen, setRuleEditDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ClaimRuleMaster | null>(null);
  const [editRuleType, setEditRuleType] = useState("");
  const [editRuleGroup, setEditRuleGroup] = useState("");
  const [editRuleDescription, setEditRuleDescription] = useState("");
  const [editRuleExpression, setEditRuleExpression] = useState("");

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

  const handleCreateDamageType = async () => {
    const name = newDamageName.trim();
    const severity = Number(newDamageSeverity);
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
      setDamageDialogOpen(false);
      setNewDamageName("");
      setNewDamageSeverity("");
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

  const openEditDamageType = (type: DamageCodeMaster) => {
    setEditingDamage(type);
    setEditDamageName(type.damage_type);
    setEditDamageSeverity(String(type.severity_percentage));
    setDamageEditDialogOpen(true);
  };

  const handleUpdateDamageType = async () => {
    if (!editingDamage) return;
    const name = editDamageName.trim();
    const severity = Number(editDamageSeverity);
    if (!name || Number.isNaN(severity)) {
      toast({
        title: "Invalid values",
        description: "Please provide a name and numeric severity percentage.",
        variant: "destructive",
      });
      return;
    }
    try {
      const updated = await updateDamageCode(editingDamage.damage_id, {
        damage_type: name,
        severity_percentage: severity,
      });
      setDamageTypes((prev) =>
        prev.map((d) => (d.damage_id === updated.damage_id ? updated : d)),
      );
      toast({ title: "Damage type updated" });
      setDamageEditDialogOpen(false);
      setEditingDamage(null);
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to update damage type", variant: "destructive" });
    }
  };

  const handleToggleDamageActive = async (type: DamageCodeMaster, next: boolean) => {
    try {
      const updated = await updateDamageCode(type.damage_id, { is_active: next });
      setDamageTypes((prev) =>
        prev.map((d) => (d.damage_id === updated.damage_id ? updated : d)),
      );
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleCreateClaimType = async () => {
    const name = newClaimTypeName.trim();
    const risk = Number(newClaimTypeRisk);
    if (!name || Number.isNaN(risk)) {
      toast({
        title: "Invalid claim type",
        description: "Please provide a name and numeric risk percentage.",
        variant: "destructive",
      });
      return;
    }
    try {
      const created = await createClaimType({
        claim_type_name: name,
        risk_percentage: risk,
        is_active: true,
      });
      setClaimTypes((prev) => [...prev, created]);
      toast({ title: "Claim type created" });
      setClaimTypeDialogOpen(false);
      setNewClaimTypeName("");
      setNewClaimTypeRisk("");
    } catch (error) {
      console.error(error);
      toast({
        title: "Failed to create claim type",
        variant: "destructive",
      });
    }
  };

  const openEditClaimType = (type: ClaimTypeMaster) => {
    setEditingClaimType(type);
    setEditClaimTypeName(type.claim_type_name);
    setEditClaimTypeRisk(String(type.risk_percentage));
    setClaimTypeEditDialogOpen(true);
  };

  const handleUpdateClaimType = async () => {
    if (!editingClaimType) return;
    const name = editClaimTypeName.trim();
    const risk = Number(editClaimTypeRisk);
    if (!name || Number.isNaN(risk)) {
      toast({
        title: "Invalid values",
        description: "Please provide a name and numeric risk percentage.",
        variant: "destructive",
      });
      return;
    }
    try {
      const updated = await updateClaimType(editingClaimType.claim_type_id, {
        claim_type_name: name,
        risk_percentage: risk,
      });
      setClaimTypes((prev) =>
        prev.map((c) =>
          c.claim_type_id === updated.claim_type_id ? updated : c,
        ),
      );
      toast({ title: "Claim type updated" });
      setClaimTypeEditDialogOpen(false);
      setEditingClaimType(null);
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to update claim type", variant: "destructive" });
    }
  };

  const handleDeleteClaimType = async (id: number) => {
    if (!window.confirm("Delete this claim type?")) return;
    try {
      await deleteClaimType(id);
      setClaimTypes((prev) => prev.filter((c) => c.claim_type_id !== id));
      toast({ title: "Claim type deleted" });
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to delete claim type", variant: "destructive" });
    }
  };

  const handleToggleClaimTypeActive = async (type: ClaimTypeMaster, next: boolean) => {
    try {
      const updated = await updateClaimType(type.claim_type_id, { is_active: next });
      setClaimTypes((prev) =>
        prev.map((c) =>
          c.claim_type_id === updated.claim_type_id ? updated : c,
        ),
      );
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleCreateRule = async () => {
    if (!newRuleType.trim() || !newRuleGroup.trim() || !newRuleExpression.trim()) {
      toast({
        title: "Missing fields",
        description: "Rule type, group and expression are required.",
        variant: "destructive",
      });
      return;
    }
    try {
      const created = await createClaimRule({
        rule_type: newRuleType.trim(),
        rule_group: newRuleGroup.trim(),
        rule_description: newRuleDescription.trim(),
        rule_expression: newRuleExpression.trim(),
        is_active: true,
      });
      setClaimRules((prev) => [...prev, created]);
      toast({ title: "Rule created" });
      setRuleDialogOpen(false);
      setNewRuleType("");
      setNewRuleGroup("");
      setNewRuleDescription("");
      setNewRuleExpression("");
    } catch (error) {
      console.error(error);
      toast({
        title: "Failed to create rule",
        variant: "destructive",
      });
    }
  };

  const openEditRule = (rule: ClaimRuleMaster) => {
    setEditingRule(rule);
    setEditRuleType(rule.rule_type);
    setEditRuleGroup(rule.rule_group);
    setEditRuleDescription(rule.rule_description ?? "");
    setEditRuleExpression(rule.rule_expression);
    setRuleEditDialogOpen(true);
  };

  const handleUpdateRule = async () => {
    if (!editingRule) return;
    if (!editRuleType.trim() || !editRuleGroup.trim() || !editRuleExpression.trim()) {
      toast({
        title: "Missing fields",
        description: "Rule type, group and expression are required.",
        variant: "destructive",
      });
      return;
    }
    try {
      const updated = await updateClaimRule(editingRule.rule_id, {
        rule_type: editRuleType.trim(),
        rule_group: editRuleGroup.trim(),
        rule_description: editRuleDescription.trim(),
        rule_expression: editRuleExpression.trim(),
      });
      setClaimRules((prev) =>
        prev.map((r) => (r.rule_id === updated.rule_id ? updated : r)),
      );
      toast({ title: "Rule updated" });
      setRuleEditDialogOpen(false);
      setEditingRule(null);
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to update rule", variant: "destructive" });
    }
  };

  const handleDeleteRule = async (id: number) => {
    if (!window.confirm("Delete this rule?")) return;
    try {
      await deleteClaimRule(id);
      setClaimRules((prev) => prev.filter((r) => r.rule_id !== id));
      toast({ title: "Rule deleted" });
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to delete rule", variant: "destructive" });
    }
  };

  const handleToggleRuleActive = async (rule: ClaimRuleMaster, next: boolean) => {
    try {
      const updated = await updateClaimRule(rule.rule_id, { is_active: next });
      setClaimRules((prev) =>
        prev.map((r) => (r.rule_id === updated.rule_id ? updated : r)),
      );
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to update status", variant: "destructive" });
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
            {/* <TabsTrigger value="automation">Automation Settings</TabsTrigger> */}
          </TabsList>

          <TabsContent value="damage-types">
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Damage Type Configuration</CardTitle>
                <Dialog open={damageDialogOpen} onOpenChange={setDamageDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Damage Type
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Damage Type</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="damage-name">Damage Type Name</Label>
                        <Input
                          id="damage-name"
                          value={newDamageName}
                          onChange={(e) => setNewDamageName(e.target.value)}
                          placeholder="e.g. bumper"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="damage-severity">Severity Percentage</Label>
                        <Input
                          id="damage-severity"
                          type="number"
                          value={newDamageSeverity}
                          onChange={(e) => setNewDamageSeverity(e.target.value)}
                          placeholder="e.g. 20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="damage-severity">Base Cost</Label>
                        <Input
                          id="damage-severity"
                          type="number"
                          value={newDamageSeverity}
                          onChange={(e) => setNewDamageSeverity(e.target.value)}
                          placeholder="e.g. 20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="damage-severity">Max Cost</Label>
                        <Input
                          id="damage-severity"
                          type="number"
                          value={newDamageSeverity}
                          onChange={(e) => setNewDamageSeverity(e.target.value)}
                          placeholder="e.g. 20"
                        />
                      </div>
                    </div>
                    <DialogFooter className="mt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setDamageDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="button" onClick={handleCreateDamageType}>
                        Save
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="table-header-bg">
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-6">Damage Type</TableHead>
                      <TableHead>Severity Percentage (%)</TableHead>
                      {/* <TableHead>Base Cost ($)</TableHead>
                      <TableHead>Max Cost ($)</TableHead> */}
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
                          <TableCell>{Math.round(type.severity_percentage)}</TableCell>
                          {/* <TableCell>-</TableCell> */}
                          <TableCell>
                            <Switch
                              checked={type.is_active}
                              onCheckedChange={(next) =>
                                handleToggleDamageActive(type, next)
                              }
                            />
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1 ">
                              <Button
                                variant="default"
                                size="icon"
                                onClick={() => openEditDamageType(type)}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="default"
                                size="icon"
                                onClick={() =>
                                  handleDeleteDamageType(type.damage_id)
                                }
                              >
                                <Trash2 className="h-4 w-4 " />
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
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Claim Type Thresholds</CardTitle>
                <Dialog open={claimTypeDialogOpen} onOpenChange={setClaimTypeDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Claim Type
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Claim Type</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="claim-type-name">Claim Type Name</Label>
                        <Input
                          id="claim-type-name"
                          value={newClaimTypeName}
                          onChange={(e) => setNewClaimTypeName(e.target.value)}
                          placeholder="e.g. SIMPLE"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="claim-type-risk">Risk Percentage</Label>
                        <Input
                          id="claim-type-risk"
                          type="number"
                          value={newClaimTypeRisk}
                          onChange={(e) => setNewClaimTypeRisk(e.target.value)}
                          placeholder="e.g. 25"
                        />
                      </div>
                    </div>
                    <DialogFooter className="mt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setClaimTypeDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="button" onClick={handleCreateClaimType}>
                        Save
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-6">Claim Type</TableHead>
                      <TableHead>Risk Percentage (%)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-6 text-right">Created At</TableHead>
                      <TableHead className="pr-6 text-right"> Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={5}>
                          Loading claim types...
                        </TableCell>
                      </TableRow>
                    ) : claimTypes.length === 0 ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={5}>
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
                            <Switch
                              checked={type.is_active}
                              onCheckedChange={(next) =>
                                handleToggleClaimTypeActive(type, next)
                              }
                            />
                          </TableCell>
                          <TableCell className="pr-6 text-right text-xs text-muted-foreground">
                            {new Date(type.created_date).toLocaleString()}
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1 ">
                              <Button
                                variant="default"
                                size="icon"
                                onClick={() => openEditClaimType(type)}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="default"
                                size="icon"
                                onClick={() => handleDeleteClaimType(type.claim_type_id)}
                              >
                                <Trash2 className="h-4 w-4 " />
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

          <TabsContent value="fraud-rules">
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Fraud Rules</CardTitle>
                <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Rule
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Fraud Rule</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="rule-type">Rule Type</Label>
                        <Input
                          id="rule-type"
                          value={newRuleType}
                          onChange={(e) => setNewRuleType(e.target.value)}
                          placeholder="e.g. Early Claim"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="rule-group">Rule Category</Label>
                        <Input
                          id="rule-group"
                          value={newRuleGroup}
                          onChange={(e) => setNewRuleGroup(e.target.value)}
                          placeholder="e.g. Fraud Check"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="rule-description">Description</Label>
                        <Input
                          id="rule-description"
                          value={newRuleDescription}
                          onChange={(e) => setNewRuleDescription(e.target.value)}
                          placeholder="Optional description"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="rule-expression">Expression</Label>
                        <Input
                          id="rule-expression"
                          value={newRuleExpression}
                          onChange={(e) => setNewRuleExpression(e.target.value)}
                          placeholder='e.g. "Claim < 30 days"'
                        />
                      </div>
                    </div>
                    <DialogFooter className="mt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setRuleDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="button" onClick={handleCreateRule}>
                        Save
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-6">Rule Type</TableHead>
                      <TableHead>Rule Category </TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={5}>
                          Loading fraud rules...
                        </TableCell>
                      </TableRow>
                    ) : claimRules.length === 0 ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={5}>
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
                            <Switch
                              checked={rule.is_active}
                              onCheckedChange={(next) =>
                                handleToggleRuleActive(rule, next)
                              }
                            />
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="default"
                                size="icon"
                                onClick={() => openEditRule(rule)}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="default"
                                size="icon"
                                onClick={() => handleDeleteRule(rule.rule_id)}
                              >
                                <Trash2 className="h-4 w-4" />
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

          {/* Edit dialogs */}
          <Dialog open={damageEditDialogOpen} onOpenChange={setDamageEditDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Damage Type</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-damage-name">Damage Type Name</Label>
                  <Input
                    id="edit-damage-name"
                    value={editDamageName}
                    onChange={(e) => setEditDamageName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-damage-severity">Severity Percentage</Label>
                  <Input
                    id="edit-damage-severity"
                    type="number"
                    value={editDamageSeverity}
                    onChange={(e) => setEditDamageSeverity(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDamageEditDialogOpen(false);
                    setEditingDamage(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={handleUpdateDamageType}>
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={claimTypeEditDialogOpen} onOpenChange={setClaimTypeEditDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Claim Type</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-claim-type-name">Claim Type Name</Label>
                  <Input
                    id="edit-claim-type-name"
                    value={editClaimTypeName}
                    onChange={(e) => setEditClaimTypeName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-claim-type-risk">Risk Percentage</Label>
                  <Input
                    id="edit-claim-type-risk"
                    type="number"
                    value={editClaimTypeRisk}
                    onChange={(e) => setEditClaimTypeRisk(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setClaimTypeEditDialogOpen(false);
                    setEditingClaimType(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={handleUpdateClaimType}>
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={ruleEditDialogOpen} onOpenChange={setRuleEditDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Fraud Rule</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-rule-type">Rule Type</Label>
                  <Input
                    id="edit-rule-type"
                    value={editRuleType}
                    onChange={(e) => setEditRuleType(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-rule-group">Rule Group</Label>
                  <Input
                    id="edit-rule-group"
                    value={editRuleGroup}
                    onChange={(e) => setEditRuleGroup(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-rule-description">Description</Label>
                  <Input
                    id="edit-rule-description"
                    value={editRuleDescription}
                    onChange={(e) => setEditRuleDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-rule-expression">Expression</Label>
                  <Input
                    id="edit-rule-expression"
                    value={editRuleExpression}
                    onChange={(e) => setEditRuleExpression(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setRuleEditDialogOpen(false);
                    setEditingRule(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={handleUpdateRule}>
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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