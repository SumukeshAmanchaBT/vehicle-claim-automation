import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  TableToolbar,
  DataTablePagination,
  SortableTableHead,
  type SortDirection,
} from "@/components/data-table";
import { Pencil, Trash2, Plus } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  getRoles,
  listPermissions,
  createPermission,
  updatePermission,
  deletePermission,
  getRolePermissions,
  assignRolePermissions,
  type Role,
  type Permission,
} from "@/services/userService";

type SortKey = "name" | "module" | "status" | "created_date";

export default function RolePermissions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<
    number[]
  >([]);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCodename, setNewCodename] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newModule, setNewModule] = useState("");
  const [newIsActive, setNewIsActive] = useState(true);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingPermission, setEditingPermission] =
    useState<Permission | null>(null);
  const [editName, setEditName] = useState("");
  const [editCodename, setEditCodename] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editModule, setEditModule] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: getRoles,
  });

  const {
    data: permissions = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["permissions"],
    queryFn: listPermissions,
  });

  const { data: rolePermissions = [] } = useQuery({
    queryKey: ["roles", selectedRoleId, "permissions"],
    queryFn: () => getRolePermissions(selectedRoleId as number),
    enabled: selectedRoleId != null,
  });

  useEffect(() => {
    if (rolePermissions && rolePermissions.length > 0) {
      setSelectedPermissionIds(rolePermissions.map((p) => p.id));
    } else {
      setSelectedPermissionIds([]);
    }
  }, [rolePermissions]);

  const createMutation = useMutation({
    mutationFn: createPermission,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      toast({ title: "Permission created successfully" });
      setIsAddOpen(false);
      setNewName("");
      setNewCodename("");
      setNewDescription("");
      setNewModule("");
      setNewIsActive(true);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Failed to create permission",
        description: "Please try again.",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Partial<
        Omit<Permission, "id" | "created_date" | "created_by">
      >;
    }) => updatePermission(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      queryClient.invalidateQueries({
        queryKey: ["roles", selectedRoleId, "permissions"],
      });
      toast({ title: "Permission updated successfully" });
      setIsEditOpen(false);
      setEditingPermission(null);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Failed to update permission",
        description: "Please try again.",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePermission(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      queryClient.invalidateQueries({
        queryKey: ["roles", selectedRoleId, "permissions"],
      });
      toast({ title: "Permission deleted successfully" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Failed to delete permission",
        description: "Please try again.",
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: (permissionIds: number[]) =>
      assignRolePermissions(selectedRoleId as number, {
        permission_ids: permissionIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["roles", selectedRoleId, "permissions"],
      });
      toast({ title: "Permissions assigned to role successfully" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Failed to assign permissions",
        description: "Please try again.",
      });
    },
  });

  const filteredPermissions = useMemo(() => {
    let list = permissions.filter((p) => {
      const term = search.toLowerCase();
      const matchesSearch =
        !term ||
        p.name.toLowerCase().includes(term) ||
        p.codename.toLowerCase().includes(term) ||
        (p.module || "").toLowerCase().includes(term);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && p.is_active) ||
        (statusFilter === "inactive" && !p.is_active);
      return matchesSearch && matchesStatus;
    });
    if (sortKey) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case "name":
            cmp = a.name.localeCompare(b.name);
            break;
          case "module":
            cmp = (a.module || "").localeCompare(b.module || "");
            break;
          case "status":
            cmp = (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0);
            break;
          case "created_date":
            cmp =
              new Date(a.created_date).getTime() -
              new Date(b.created_date).getTime();
            break;
          default:
            break;
        }
        return sortDir === "desc" ? -cmp : cmp;
      });
    }
    return list;
  }, [permissions, search, statusFilter, sortKey, sortDir]);

  const paginatedPermissions = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredPermissions.slice(start, start + pageSize);
  }, [filteredPermissions, page, pageSize]);

  const handleSort = (key: string) => {
    const k = key as SortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(1);
  };

  const toggleAssigned = (permissionId: number, next: boolean) => {
    setSelectedPermissionIds((prev) => {
      if (next) {
        return Array.from(new Set([...prev, permissionId]));
      }
      return prev.filter((id) => id !== permissionId);
    });
  };

  const handleOpenAdd = () => {
    setNewName("");
    setNewCodename("");
    setNewDescription("");
    setNewModule("");
    setNewIsActive(true);
    setIsAddOpen(true);
  };

  const handleEditPermission = (permission: Permission) => {
    setEditingPermission(permission);
    setEditName(permission.name);
    setEditCodename(permission.codename);
    setEditDescription(permission.description || "");
    setEditModule(permission.module || "");
    setEditIsActive(permission.is_active);
    setIsEditOpen(true);
  };

  const handleDeletePermission = (permission: Permission) => {
    if (
      !window.confirm(
        `Delete permission "${permission.name}" (${permission.codename})?`
      )
    ) {
      return;
    }
    deleteMutation.mutate(permission.id);
  };

  const handleSaveAssignments = () => {
    if (!selectedRoleId) {
      toast({
        variant: "destructive",
        title: "Select a role first",
      });
      return;
    }
    assignMutation.mutate(selectedPermissionIds);
  };

  return (
    <AppLayout
      title="Role Permissions"
      subtitle="Configure feature-level permissions for each role"
    >
      <div className="space-y-6 animate-fade-in">
        <TableToolbar
          searchPlaceholder="Search permissions..."
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          filters={
            <div className="flex gap-2">
              <Select
                value={selectedRoleId ? String(selectedRoleId) : "none"}
                onValueChange={(v) => {
                  const id = v === "none" ? null : Number(v);
                  setSelectedRoleId(id);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All Roles</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={String(role.id)}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select> */}
            </div>
          }
          primaryAction={
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button onClick={handleOpenAdd} disabled={createMutation.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  {createMutation.isPending ? "Adding..." : "Add Permission"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form
                  onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
                    e.preventDefault();
                    if (!newName.trim() || !newCodename.trim()) return;
                    createMutation.mutate({
                      name: newName.trim(),
                      codename: newCodename.trim(),
                      description: newDescription.trim(),
                      module: newModule.trim(),
                      is_active: newIsActive,
                    } as any);
                  }}
                >
                  <DialogHeader>
                    <DialogTitle>Create Permission</DialogTitle>
                    <DialogDescription>
                      Define a new permission that can be assigned to roles.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="perm-name">Name</Label>
                      <Input
                        id="perm-name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="perm-codename">Codename</Label>
                      <Input
                        id="perm-codename"
                        value={newCodename}
                        onChange={(e) => setNewCodename(e.target.value)}
                        placeholder="e.g. claims.view"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="perm-module">Module</Label>
                      <Input
                        id="perm-module"
                        value={newModule}
                        onChange={(e) => setNewModule(e.target.value)}
                        placeholder="e.g. claims"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="perm-description">Description</Label>
                      <Input
                        id="perm-description"
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        placeholder="Optional description"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Active</Label>
                        <p className="text-xs text-muted-foreground">
                          Inactive permissions cannot be used.
                        </p>
                      </div>
                      <Switch
                        checked={newIsActive}
                        onCheckedChange={setNewIsActive}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsAddOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createMutation.isPending}>
                      {createMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          }
        />

        <Card className="card-elevated overflow-hidden border-none">
          <Table>
            <TableHeader className="table-header-bg">
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-6 w-12">SNo</TableHead>
                <SortableTableHead
                  sortKey="name"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Permission
                </SortableTableHead>
                <TableHead>Codename</TableHead>
                <SortableTableHead
                  sortKey="module"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Module
                </SortableTableHead>
                <SortableTableHead
                  sortKey="status"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Active
                </SortableTableHead>
                {/* <TableHead>Assigned to Role</TableHead> */}
                <SortableTableHead
                  sortKey="created_date"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Created Date
                </SortableTableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Loading permissions...
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-12 text-center text-destructive"
                  >
                    Failed to load permissions. Please try again.
                  </TableCell>
                </TableRow>
              ) : filteredPermissions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No permissions found.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedPermissions.map((permission, index) => {
                  const isAssigned = selectedPermissionIds.includes(
                    permission.id
                  );
                  return (
                    <TableRow key={permission.id} className="group">
                      <TableCell className="pl-6 font-medium">
                        {(page - 1) * pageSize + index + 1}
                      </TableCell>
                      <TableCell className="font-medium">
                        {permission.name}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {permission.codename}
                      </TableCell>
                      <TableCell>{permission.module || "—"}</TableCell>
                      <TableCell>
                        <Switch
                          checked={permission.is_active}
                          onCheckedChange={(next) =>
                            updateMutation.mutate({
                              id: permission.id,
                              payload: { is_active: next },
                            })
                          }
                          disabled={updateMutation.isPending}
                        />
                      </TableCell>
                      {/* <TableCell>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={isAssigned}
                            disabled={!selectedRoleId || assignMutation.isPending}
                            onCheckedChange={(value) =>
                              toggleAssigned(
                                permission.id,
                                Boolean(value) as boolean
                              )
                            }
                          />
                          <span className="text-xs text-muted-foreground">
                            {selectedRoleId ? "Assigned" : "Select role"}
                          </span>
                        </div>
                      </TableCell> */}
                      <TableCell className="text-sm text-muted-foreground">
                        {permission.created_date
                          ? new Date(
                              permission.created_date
                            ).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })
                          : "—"}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-primary hover:text-primary"
                            title="Edit permission"
                            onClick={() => handleEditPermission(permission)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            title="Delete permission"
                            onClick={() => handleDeletePermission(permission)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/40">
            <div className="text-xs text-muted-foreground">
              {selectedRoleId
                ? "Select permissions and click Save to assign to the role."
                : "Select a role to assign permissions."}
            </div>
            <Button
              size="sm"
              onClick={handleSaveAssignments}
              disabled={!selectedRoleId || assignMutation.isPending}
            >
              {assignMutation.isPending ? "Saving..." : "Save Permissions"}
            </Button>
          </div>
          {/* Edit Permission Dialog */}
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogContent>
              <form
                onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  if (!editingPermission) return;
                  updateMutation.mutate({
                    id: editingPermission.id,
                    payload: {
                      name: editName.trim(),
                      codename: editCodename.trim(),
                      description: editDescription.trim(),
                      module: editModule.trim(),
                      is_active: editIsActive,
                    },
                  });
                }}
              >
                <DialogHeader>
                  <DialogTitle>Edit Permission</DialogTitle>
                  <DialogDescription>
                    Update permission details. Changes affect all roles using
                    this permission.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-perm-name">Name</Label>
                    <Input
                      id="edit-perm-name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-perm-codename">Codename</Label>
                    <Input
                      id="edit-perm-codename"
                      value={editCodename}
                      onChange={(e) => setEditCodename(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-perm-module">Module</Label>
                    <Input
                      id="edit-perm-module"
                      value={editModule}
                      onChange={(e) => setEditModule(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-perm-description">Description</Label>
                    <Input
                      id="edit-perm-description"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Active</Label>
                      <p className="text-xs text-muted-foreground">
                        Inactive permissions cannot be used.
                      </p>
                    </div>
                    <Switch
                      checked={editIsActive}
                      onCheckedChange={setEditIsActive}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsEditOpen(false);
                      setEditingPermission(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <DataTablePagination
            totalCount={filteredPermissions.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            itemLabel="permissions"
          />
        </Card>
      </div>
    </AppLayout>
  );
}
