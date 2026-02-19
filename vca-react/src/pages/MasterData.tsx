import { useEffect, useState, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import { TableToolbar, DataTablePagination, SortableTableHead, type SortDirection } from "@/components/data-table";
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
  getPricingConfigs,
  createPricingConfig,
  updatePricingConfig,
  deletePricingConfig,
  type ClaimRuleMaster,
  type ClaimTypeMaster,
  type DamageCodeMaster,
  type PricingConfigMaster,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export default function MasterData() {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const canViewDamageConfig = hasPermission("damage_config.view");
  const canUpdateDamageConfig = hasPermission("damage_config.update");
  const canDeleteDamageConfig = hasPermission("damage_config.delete");
  const canViewClaimConfig = hasPermission("claim_config.view");
  const canUpdateClaimConfig = hasPermission("claim_config.update");
  const canDeleteClaimConfig = hasPermission("claim_config.delete");
  const canViewFraudRules = hasPermission("fraud_rules.view");
  const canUpdateFraudRules = hasPermission("fraud_rules.update");
  const canDeleteFraudRules = hasPermission("fraud_rules.delete");
  const canViewPriceConfig = hasPermission("price_config.view");
  const canUpdatePriceConfig = hasPermission("price_config.update");
  const canDeletePriceConfig = hasPermission("price_config.delete");

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

  const [pricingConfigs, setPricingConfigs] = useState<PricingConfigMaster[]>([]);
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  const [newConfigKey, setNewConfigKey] = useState("");
  const [newConfigName, setNewConfigName] = useState("");
  const [newConfigValue, setNewConfigValue] = useState("");
  const [newConfigType, setNewConfigType] = useState("string");
  const [newConfigDescription, setNewConfigDescription] = useState("");
  const [pricingEditDialogOpen, setPricingEditDialogOpen] = useState(false);
  const [editingPricing, setEditingPricing] = useState<PricingConfigMaster | null>(null);
  const [editConfigKey, setEditConfigKey] = useState("");
  const [editConfigName, setEditConfigName] = useState("");
  const [editConfigValue, setEditConfigValue] = useState("");
  const [editConfigType, setEditConfigType] = useState("string");
  const [editConfigDescription, setEditConfigDescription] = useState("");
  const [editConfigActive, setEditConfigActive] = useState(true);

  const sectionParam =
    new URLSearchParams(location.search).get("section") ?? "damage-types";

  const [activeTab, setActiveTab] = useState(sectionParam);

  // Damage types: search, sort, pagination
  const [damageSearch, setDamageSearch] = useState("");
  const [damageSortKey, setDamageSortKey] = useState<"name" | "severity" | "status" | null>("name");
  const [damageSortDir, setDamageSortDir] = useState<SortDirection>("asc");
  const [damagePage, setDamagePage] = useState(1);
  const [damagePageSize, setDamagePageSize] = useState(10);

  const filteredDamage = useMemo(() => {
    const term = damageSearch.toLowerCase();
    return damageTypes.filter(
      (d) =>
        d.damage_type?.toLowerCase().includes(term),
    );
  }, [damageTypes, damageSearch]);
  const sortedDamage = useMemo(() => {
    if (!damageSortKey) return filteredDamage;
    return [...filteredDamage].sort((a, b) => {
      let cmp = 0;
      if (damageSortKey === "name") cmp = (a.damage_type ?? "").localeCompare(b.damage_type ?? "");
      else if (damageSortKey === "severity") cmp = a.severity_percentage - b.severity_percentage;
      else if (damageSortKey === "status") cmp = (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0);
      return damageSortDir === "desc" ? -cmp : cmp;
    });
  }, [filteredDamage, damageSortKey, damageSortDir]);
  const paginatedDamage = useMemo(() => {
    const start = (damagePage - 1) * damagePageSize;
    return sortedDamage.slice(start, start + damagePageSize);
  }, [sortedDamage, damagePage, damagePageSize]);

  // Claim types: search, sort, pagination
  const [claimTypeSearch, setClaimTypeSearch] = useState("");
  const [claimTypeSortKey, setClaimTypeSortKey] = useState<"name" | "risk" | "status" | null>("name");
  const [claimTypeSortDir, setClaimTypeSortDir] = useState<SortDirection>("asc");
  const [claimTypePage, setClaimTypePage] = useState(1);
  const [claimTypePageSize, setClaimTypePageSize] = useState(10);

  const filteredClaimTypes = useMemo(() => {
    const term = claimTypeSearch.toLowerCase();
    return claimTypes.filter((c) => c.claim_type_name?.toLowerCase().includes(term));
  }, [claimTypes, claimTypeSearch]);
  const sortedClaimTypes = useMemo(() => {
    if (!claimTypeSortKey) return filteredClaimTypes;
    return [...filteredClaimTypes].sort((a, b) => {
      let cmp = 0;
      if (claimTypeSortKey === "name") cmp = (a.claim_type_name ?? "").localeCompare(b.claim_type_name ?? "");
      else if (claimTypeSortKey === "risk") cmp = a.risk_percentage - b.risk_percentage;
      else if (claimTypeSortKey === "status") cmp = (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0);
      return claimTypeSortDir === "desc" ? -cmp : cmp;
    });
  }, [filteredClaimTypes, claimTypeSortKey, claimTypeSortDir]);
  const paginatedClaimTypes = useMemo(() => {
    const start = (claimTypePage - 1) * claimTypePageSize;
    return sortedClaimTypes.slice(start, start + claimTypePageSize);
  }, [sortedClaimTypes, claimTypePage, claimTypePageSize]);

  // Fraud rules: search, sort, pagination
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleSortKey, setRuleSortKey] = useState<"type" | "group" | "expression" | "status" | null>("type");
  const [ruleSortDir, setRuleSortDir] = useState<SortDirection>("asc");
  const [rulePage, setRulePage] = useState(1);
  const [rulePageSize, setRulePageSize] = useState(10);

  const filteredRules = useMemo(() => {
    const term = ruleSearch.toLowerCase();
    return claimRules.filter(
      (r) =>
        r.rule_type?.toLowerCase().includes(term) ||
        r.rule_group?.toLowerCase().includes(term) ||
        r.rule_expression?.toLowerCase().includes(term),
    );
  }, [claimRules, ruleSearch]);
  const sortedRules = useMemo(() => {
    if (!ruleSortKey) return filteredRules;
    return [...filteredRules].sort((a, b) => {
      let cmp = 0;
      if (ruleSortKey === "type") cmp = (a.rule_type ?? "").localeCompare(b.rule_type ?? "");
      else if (ruleSortKey === "group") cmp = (a.rule_group ?? "").localeCompare(b.rule_group ?? "");
      else if (ruleSortKey === "expression") cmp = (a.rule_expression ?? "").localeCompare(b.rule_expression ?? "");
      else if (ruleSortKey === "status") cmp = (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0);
      return ruleSortDir === "desc" ? -cmp : cmp;
    });
  }, [filteredRules, ruleSortKey, ruleSortDir]);
  const paginatedRules = useMemo(() => {
    const start = (rulePage - 1) * rulePageSize;
    return sortedRules.slice(start, start + rulePageSize);
  }, [sortedRules, rulePage, rulePageSize]);

  // Pricing config: search, sort, pagination
  const [pricingSearch, setPricingSearch] = useState("");
  const [pricingSortKey, setPricingSortKey] = useState<"key" | "name" | "value" | "type" | "status" | null>("key");
  const [pricingSortDir, setPricingSortDir] = useState<SortDirection>("asc");
  const [pricingPage, setPricingPage] = useState(1);
  const [pricingPageSize, setPricingPageSize] = useState(10);

  const filteredPricing = useMemo(() => {
    const term = pricingSearch.toLowerCase();
    return pricingConfigs.filter(
      (p) =>
        p.config_key?.toLowerCase().includes(term) ||
        p.config_name?.toLowerCase().includes(term) ||
        p.config_value?.toLowerCase().includes(term),
    );
  }, [pricingConfigs, pricingSearch]);
  const sortedPricing = useMemo(() => {
    if (!pricingSortKey) return filteredPricing;
    return [...filteredPricing].sort((a, b) => {
      let cmp = 0;
      if (pricingSortKey === "key") cmp = (a.config_key ?? "").localeCompare(b.config_key ?? "");
      else if (pricingSortKey === "name") cmp = (a.config_name ?? "").localeCompare(b.config_name ?? "");
      else if (pricingSortKey === "value") cmp = (a.config_value ?? "").localeCompare(b.config_value ?? "");
      else if (pricingSortKey === "type") cmp = (a.config_type ?? "").localeCompare(b.config_type ?? "");
      else if (pricingSortKey === "status") cmp = (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0);
      return pricingSortDir === "desc" ? -cmp : cmp;
    });
  }, [filteredPricing, pricingSortKey, pricingSortDir]);
  const paginatedPricing = useMemo(() => {
    const start = (pricingPage - 1) * pricingPageSize;
    return sortedPricing.slice(start, start + pricingPageSize);
  }, [sortedPricing, pricingPage, pricingPageSize]);

  useEffect(() => {
    setActiveTab(sectionParam);
  }, [sectionParam]);

  useEffect(() => {
    async function loadMasterData() {
      try {
        const [damage, types, rules, pricing] = await Promise.all([
          getDamageCodes(),
          getClaimTypes(),
          getClaimRules(),
          getPricingConfigs(),
        ]);
        setDamageTypes(damage);
        setClaimTypes(types);
        setClaimRules(rules);
        setPricingConfigs(pricing);
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

  const handleCreatePricingConfig = async () => {
    if (!newConfigKey.trim() || !newConfigName.trim()) {
      toast({
        title: "Missing fields",
        description: "Config key and config name are required.",
        variant: "destructive",
      });
      return;
    }
    try {
      const created = await createPricingConfig({
        config_key: newConfigKey.trim(),
        config_name: newConfigName.trim(),
        config_value: newConfigValue.trim(),
        config_type: newConfigType,
        description: newConfigDescription.trim(),
        is_active: true,
      });
      setPricingConfigs((prev) => [...prev, created]);
      toast({ title: "Pricing config created" });
      setPricingDialogOpen(false);
      setNewConfigKey("");
      setNewConfigName("");
      setNewConfigValue("");
      setNewConfigType("string");
      setNewConfigDescription("");
    } catch (error) {
      console.error(error);
      toast({
        title: "Failed to create pricing config",
        variant: "destructive",
      });
    }
  };

  const openEditPricingConfig = (config: PricingConfigMaster) => {
    setEditingPricing(config);
    setEditConfigKey(config.config_key);
    setEditConfigName(config.config_name);
    setEditConfigValue(config.config_value);
    setEditConfigType(config.config_type);
    setEditConfigDescription(config.description ?? "");
    setEditConfigActive(config.is_active);
    setPricingEditDialogOpen(true);
  };

  const handleUpdatePricingConfig = async () => {
    if (!editingPricing) return;
    if (!editConfigKey.trim() || !editConfigName.trim()) {
      toast({
        title: "Invalid values",
        description: "Config key and config name are required.",
        variant: "destructive",
      });
      return;
    }
    try {
      const updated = await updatePricingConfig(editingPricing.config_id, {
        config_key: editConfigKey.trim(),
        config_name: editConfigName.trim(),
        config_value: editConfigValue.trim(),
        config_type: editConfigType,
        description: editConfigDescription.trim(),
        is_active: editConfigActive,
      });
      setPricingConfigs((prev) =>
        prev.map((p) => (p.config_id === updated.config_id ? updated : p)),
      );
      toast({ title: "Pricing config updated" });
      setPricingEditDialogOpen(false);
      setEditingPricing(null);
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to update pricing config", variant: "destructive" });
    }
  };

  const handleDeletePricingConfig = async (id: number) => {
    if (!window.confirm("Delete this pricing config?")) return;
    try {
      await deletePricingConfig(id);
      setPricingConfigs((prev) => prev.filter((p) => p.config_id !== id));
      toast({ title: "Pricing config deleted" });
    } catch (error) {
      console.error(error);
      toast({
        title: "Failed to delete pricing config",
        variant: "destructive",
      });
    }
  };

  const handleTogglePricingConfigActive = async (config: PricingConfigMaster, next: boolean) => {
    try {
      const updated = await updatePricingConfig(config.config_id, { is_active: next });
      setPricingConfigs((prev) =>
        prev.map((p) => (p.config_id === updated.config_id ? updated : p)),
      );
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const canViewAnyMaster =
    canViewDamageConfig || canViewClaimConfig || canViewFraudRules || canViewPriceConfig;

  if (!canViewAnyMaster) {
    return (
      <AppLayout
        title="Master Data"
        subtitle="Configure damage types, thresholds, and automation rules"
      >
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          You do not have permission to view master data.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Master Data"
      subtitle="Configure damage types, thresholds, and automation rules"
    >
      <div className="space-y-6 animate-fade-in">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value);
            const params = new URLSearchParams(location.search);
            params.set("section", value);
            navigate({ pathname: location.pathname, search: params.toString() });
          }}
          className="space-y-4"
        >
          {/* <TabsList>
            <TabsTrigger value="damage-types">Damage Types</TabsTrigger>
            <TabsTrigger value="thresholds">Claim Thresholds</TabsTrigger>
            <TabsTrigger value="fraud-rules">Fraud Rules</TabsTrigger>
           <TabsTrigger value="automation">Automation Settings</TabsTrigger> 
          </TabsList> */}

          {canViewDamageConfig && (
          <TabsContent value="damage-types">
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Damage Configuration</CardTitle>
                {canUpdateDamageConfig && (
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
                )}
              </CardHeader>
              <CardContent className="p-0">
                <TableToolbar
                  searchPlaceholder="Search damage types..."
                  searchValue={damageSearch}
                  onSearchChange={(v) => { setDamageSearch(v); setDamagePage(1); }}
                  className="border-0 border-b rounded-none shadow-none"
                />
                <Table>
                  <TableHeader className="table-header-bg">
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <SortableTableHead
                        sortKey="name"
                        currentSortKey={damageSortKey}
                        direction={damageSortDir}
                        onSort={(k) => {
                          if (damageSortKey === k) setDamageSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setDamageSortKey(k as "name" | "severity" | "status"); setDamageSortDir("asc"); }
                          setDamagePage(1);
                        }}
                        className="pl-6"
                      >
                        Damage Type
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="severity"
                        currentSortKey={damageSortKey}
                        direction={damageSortDir}
                        onSort={(k) => {
                          if (damageSortKey === k) setDamageSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setDamageSortKey(k as "name" | "severity" | "status"); setDamageSortDir("asc"); }
                          setDamagePage(1);
                        }}
                      >
                        Severity (%)
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="status"
                        currentSortKey={damageSortKey}
                        direction={damageSortDir}
                        onSort={(k) => {
                          if (damageSortKey === k) setDamageSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setDamageSortKey(k as "name" | "severity" | "status"); setDamageSortDir("asc"); }
                          setDamagePage(1);
                        }}
                      >
                        Status
                      </SortableTableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={4}>
                          Loading damage types...
                        </TableCell>
                      </TableRow>
                    ) : filteredDamage.length === 0 ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={4}>
                          No damage types configured yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedDamage.map((type) => (
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
                              disabled={!canUpdateDamageConfig}
                            />
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1 ">
                              {canUpdateDamageConfig && (
                                <Button
                                  variant="default"
                                  size="icon"
                                  onClick={() => openEditDamageType(type)}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                              )}
                              {canDeleteDamageConfig && (
                                <Button
                                  variant="default"
                                  size="icon"
                                  onClick={() =>
                                    handleDeleteDamageType(type.damage_id)
                                  }
                                >
                                  <Trash2 className="h-4 w-4 " />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <DataTablePagination
                  totalCount={sortedDamage.length}
                  page={damagePage}
                  pageSize={damagePageSize}
                  onPageChange={setDamagePage}
                  onPageSizeChange={(s) => { setDamagePageSize(s); setDamagePage(1); }}
                  itemLabel="damage types"
                />
              </CardContent>
            </Card>
          </TabsContent>
          )}

          {canViewClaimConfig && (
          <TabsContent value="thresholds">
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Claim Configuration</CardTitle>
                {canUpdateClaimConfig && (
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
                )}
              </CardHeader>
              <CardContent className="p-0">
                <TableToolbar
                  searchPlaceholder="Search claim types..."
                  searchValue={claimTypeSearch}
                  onSearchChange={(v) => { setClaimTypeSearch(v); setClaimTypePage(1); }}
                  className="border-0 border-b rounded-none shadow-none"
                />
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <SortableTableHead
                        sortKey="name"
                        currentSortKey={claimTypeSortKey}
                        direction={claimTypeSortDir}
                        onSort={(k) => {
                          if (claimTypeSortKey === k) setClaimTypeSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setClaimTypeSortKey(k as "name" | "risk" | "status"); setClaimTypeSortDir("asc"); }
                          setClaimTypePage(1);
                        }}
                        className="pl-6"
                      >
                        Claim Type
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="risk"
                        currentSortKey={claimTypeSortKey}
                        direction={claimTypeSortDir}
                        onSort={(k) => {
                          if (claimTypeSortKey === k) setClaimTypeSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setClaimTypeSortKey(k as "name" | "risk" | "status"); setClaimTypeSortDir("asc"); }
                          setClaimTypePage(1);
                        }}
                      >
                        Risk (%)
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="status"
                        currentSortKey={claimTypeSortKey}
                        direction={claimTypeSortDir}
                        onSort={(k) => {
                          if (claimTypeSortKey === k) setClaimTypeSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setClaimTypeSortKey(k as "name" | "risk" | "status"); setClaimTypeSortDir("asc"); }
                          setClaimTypePage(1);
                        }}
                      >
                        Status
                      </SortableTableHead>
                      <TableHead className="pr-6 text-right">Created At</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={5}>
                          Loading claim types...
                        </TableCell>
                      </TableRow>
                    ) : filteredClaimTypes.length === 0 ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={5}>
                          No claim types configured.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedClaimTypes.map((type) => (
                        <TableRow key={type.claim_type_id}>
                          <TableCell className="pl-6 font-medium">
                            {type.claim_type_name}
                          </TableCell>
                          <TableCell>{Math.round(type.risk_percentage)}</TableCell>
                          <TableCell>
                            <Switch
                              checked={type.is_active}
                              onCheckedChange={(next) =>
                                handleToggleClaimTypeActive(type, next)
                              }
                              disabled={!canUpdateClaimConfig}
                            />
                          </TableCell>
                          <TableCell className="pr-6 text-right text-xs text-muted-foreground">
                            {new Date(type.created_date).toLocaleString()}
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1 ">
                              {canUpdateClaimConfig && (
                                <Button
                                  variant="default"
                                  size="icon"
                                  onClick={() => openEditClaimType(type)}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                              )}
                              {canDeleteClaimConfig && (
                                <Button
                                  variant="default"
                                  size="icon"
                                  onClick={() => handleDeleteClaimType(type.claim_type_id)}
                                >
                                  <Trash2 className="h-4 w-4 " />
                                </Button>
                              )}
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
          )}

          {canViewFraudRules && (
          <TabsContent value="fraud-rules">
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Fraud Rules</CardTitle>
                {canUpdateFraudRules && (
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
                )}
              </CardHeader>
              <CardContent className="p-0">
                <TableToolbar
                  searchPlaceholder="Search rules..."
                  searchValue={ruleSearch}
                  onSearchChange={(v) => { setRuleSearch(v); setRulePage(1); }}
                  className="border-0 border-b rounded-none shadow-none"
                />
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <SortableTableHead
                        sortKey="type"
                        currentSortKey={ruleSortKey}
                        direction={ruleSortDir}
                        onSort={(k) => {
                          if (ruleSortKey === k) setRuleSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setRuleSortKey(k as "type" | "group" | "expression" | "status"); setRuleSortDir("asc"); }
                          setRulePage(1);
                        }}
                        className="pl-6"
                      >
                        Rule Type
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="group"
                        currentSortKey={ruleSortKey}
                        direction={ruleSortDir}
                        onSort={(k) => {
                          if (ruleSortKey === k) setRuleSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setRuleSortKey(k as "type" | "group" | "expression" | "status"); setRuleSortDir("asc"); }
                          setRulePage(1);
                        }}
                      >
                        Rule Category
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="expression"
                        currentSortKey={ruleSortKey}
                        direction={ruleSortDir}
                        onSort={(k) => {
                          if (ruleSortKey === k) setRuleSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setRuleSortKey(k as "type" | "group" | "expression" | "status"); setRuleSortDir("asc"); }
                          setRulePage(1);
                        }}
                      >
                        Description
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="status"
                        currentSortKey={ruleSortKey}
                        direction={ruleSortDir}
                        onSort={(k) => {
                          if (ruleSortKey === k) setRuleSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setRuleSortKey(k as "type" | "group" | "expression" | "status"); setRuleSortDir("asc"); }
                          setRulePage(1);
                        }}
                      >
                        Status
                      </SortableTableHead>
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
                    ) : filteredRules.length === 0 ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={5}>
                          No fraud rules configured.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedRules.map((rule) => (
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
                              disabled={!canUpdateFraudRules}
                            />
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {canUpdateFraudRules && (
                                <Button
                                  variant="default"
                                  size="icon"
                                  onClick={() => openEditRule(rule)}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                              )}
                              {canDeleteFraudRules && (
                                <Button
                                  variant="default"
                                  size="icon"
                                  onClick={() => handleDeleteRule(rule.rule_id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <DataTablePagination
                  totalCount={sortedRules.length}
                  page={rulePage}
                  pageSize={rulePageSize}
                  onPageChange={setRulePage}
                  onPageSizeChange={(s) => { setRulePageSize(s); setRulePage(1); }}
                  itemLabel="rules"
                />
              </CardContent>
            </Card>
          </TabsContent>
          )}

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

          <Dialog open={pricingEditDialogOpen} onOpenChange={setPricingEditDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Pricing Config</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-config-key">Config Key</Label>
                  <Input
                    id="edit-config-key"
                    value={editConfigKey}
                    onChange={(e) => setEditConfigKey(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-config-name">Config Name</Label>
                  <Input
                    id="edit-config-name"
                    value={editConfigName}
                    onChange={(e) => setEditConfigName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-config-value">Config Value</Label>
                  <Input
                    id="edit-config-value"
                    value={editConfigValue}
                    onChange={(e) => setEditConfigValue(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-config-type">Config Type</Label>
                  <select
                    id="edit-config-type"
                    value={editConfigType}
                    onChange={(e) => setEditConfigType(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="decimal">decimal</option>
                    <option value="json">json</option>
                    <option value="boolean">boolean</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-config-description">Description</Label>
                  <Input
                    id="edit-config-description"
                    value={editConfigDescription}
                    onChange={(e) => setEditConfigDescription(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="edit-config-active"
                    checked={editConfigActive}
                    onCheckedChange={setEditConfigActive}
                  />
                  <Label htmlFor="edit-config-active">Active</Label>
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPricingEditDialogOpen(false);
                    setEditingPricing(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={handleUpdatePricingConfig}>
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {canViewPriceConfig && (
          <TabsContent value="PriceConfig">
            <Card className="card-elevated">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Price Configuration</CardTitle>
                {canUpdatePriceConfig && (
                <Dialog open={pricingDialogOpen} onOpenChange={setPricingDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Config
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Pricing Config</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="config-key">Config Key</Label>
                        <Input
                          id="config-key"
                          value={newConfigKey}
                          onChange={(e) => setNewConfigKey(e.target.value)}
                          placeholder="e.g. max_claim_amount"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="config-name">Config Name</Label>
                        <Input
                          id="config-name"
                          value={newConfigName}
                          onChange={(e) => setNewConfigName(e.target.value)}
                          placeholder="e.g. Maximum Claim Amount"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="config-value">Config Value</Label>
                        <Input
                          id="config-value"
                          value={newConfigValue}
                          onChange={(e) => setNewConfigValue(e.target.value)}
                          placeholder="e.g. 50000"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="config-type">Config Type</Label>
                        <select
                          id="config-type"
                          value={newConfigType}
                          onChange={(e) => setNewConfigType(e.target.value)}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <option value="string">string</option>
                          <option value="number">number</option>
                          <option value="decimal">decimal</option>
                          <option value="json">json</option>
                          <option value="boolean">boolean</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="config-description">Description</Label>
                        <Input
                          id="config-description"
                          value={newConfigDescription}
                          onChange={(e) => setNewConfigDescription(e.target.value)}
                          placeholder="Optional description"
                        />
                      </div>
                    </div>
                    <DialogFooter className="mt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setPricingDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="button" onClick={handleCreatePricingConfig}>
                        Save
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <TableToolbar
                  searchPlaceholder="Search configs..."
                  searchValue={pricingSearch}
                  onSearchChange={(v) => { setPricingSearch(v); setPricingPage(1); }}
                  className="border-0 border-b rounded-none shadow-none"
                />
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <SortableTableHead
                        sortKey="key"
                        currentSortKey={pricingSortKey}
                        direction={pricingSortDir}
                        onSort={(k) => {
                          if (pricingSortKey === k) setPricingSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setPricingSortKey(k as "key" | "name" | "value" | "type" | "status"); setPricingSortDir("asc"); }
                          setPricingPage(1);
                        }}
                        className="pl-6"
                      >
                        Config Key
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="name"
                        currentSortKey={pricingSortKey}
                        direction={pricingSortDir}
                        onSort={(k) => {
                          if (pricingSortKey === k) setPricingSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setPricingSortKey(k as "key" | "name" | "value" | "type" | "status"); setPricingSortDir("asc"); }
                          setPricingPage(1);
                        }}
                      >
                        Config Name
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="value"
                        currentSortKey={pricingSortKey}
                        direction={pricingSortDir}
                        onSort={(k) => {
                          if (pricingSortKey === k) setPricingSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setPricingSortKey(k as "key" | "name" | "value" | "type" | "status"); setPricingSortDir("asc"); }
                          setPricingPage(1);
                        }}
                      >
                        Price
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="type"
                        currentSortKey={pricingSortKey}
                        direction={pricingSortDir}
                        onSort={(k) => {
                          if (pricingSortKey === k) setPricingSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setPricingSortKey(k as "key" | "name" | "value" | "type" | "status"); setPricingSortDir("asc"); }
                          setPricingPage(1);
                        }}
                      >
                        Type
                      </SortableTableHead>
                      <SortableTableHead
                        sortKey="status"
                        currentSortKey={pricingSortKey}
                        direction={pricingSortDir}
                        onSort={(k) => {
                          if (pricingSortKey === k) setPricingSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          else { setPricingSortKey(k as "key" | "name" | "value" | "type" | "status"); setPricingSortDir("asc"); }
                          setPricingPage(1);
                        }}
                      >
                        Status
                      </SortableTableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={6}>
                          Loading pricing configs...
                        </TableCell>
                      </TableRow>
                    ) : filteredPricing.length === 0 ? (
                      <TableRow>
                        <TableCell className="pl-6" colSpan={6}>
                          No pricing configs configured.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedPricing.map((config) => (
                        <TableRow key={config.config_id}>
                          <TableCell className="pl-6 font-medium">
                            {config.config_key}
                          </TableCell>
                          <TableCell>{config.config_name}</TableCell>
                          <TableCell className="max-w-[120px] truncate">{config.config_value}</TableCell>
                          <TableCell>{config.config_type}</TableCell>
                          <TableCell>
                            <Switch
                              checked={config.is_active}
                              onCheckedChange={(next) =>
                                handleTogglePricingConfigActive(config, next)
                              }
                              disabled={!canUpdatePriceConfig}
                            />
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {canUpdatePriceConfig && (
                                <Button
                                  variant="default"
                                  size="icon"
                                  onClick={() => openEditPricingConfig(config)}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                              )}
                              {canDeletePriceConfig && (
                                <Button
                                  variant="default"
                                  size="icon"
                                  onClick={() => handleDeletePricingConfig(config.config_id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <DataTablePagination
                  totalCount={sortedPricing.length}
                  page={pricingPage}
                  pageSize={pricingPageSize}
                  onPageChange={setPricingPage}
                  onPageSizeChange={(s) => { setPricingPageSize(s); setPricingPage(1); }}
                  itemLabel="configs"
                />
              </CardContent>
            </Card>
          </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}