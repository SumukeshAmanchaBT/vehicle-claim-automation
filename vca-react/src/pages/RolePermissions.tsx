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
import { useAuth } from "@/contexts/AuthContext";

type SortKey = "name" | "module" | "status" | "created_date";

export default function RolePermissions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canViewRolePermissions = hasPermission("role_permissions.view");
  const canUpdateRolePermissions = hasPermission("role_permissions.update");
  const canDeleteRolePermissions = hasPermission("role_permissions.delete");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  /** Role filter: "all" = both Admin & User columns, "admin" or "user" = single role */
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<
    number[]
  >([]);
  const [adminPermissionIds, setAdminPermissionIds] = useState<number[]>([]);
  const [userPermissionIds, setUserPermissionIds] = useState<number[]>([]);

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

  const adminRole = roles.find((r) => r.name.toLowerCase() === "admin");
  const userRole = roles.find((r) => r.name.toLowerCase() === "user");
  const adminRoleId = adminRole?.id ?? null;
  const userRoleId = userRole?.id ?? null;

  const {
    data: permissions = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["permissions"],
    queryFn: listPermissions,
  });

  const fetchAdmin = roleFilter === "all" || roleFilter === "admin";
  const fetchUser = roleFilter === "all" || roleFilter === "user";

  const { data: adminRolePermissions = [] } = useQuery({
    queryKey: ["roles", adminRoleId, "permissions"],
    queryFn: () => getRolePermissions(adminRoleId!),
    enabled: fetchAdmin && adminRoleId != null,
  });

  const { data: userRolePermissions = [] } = useQuery({
    queryKey: ["roles", userRoleId, "permissions"],
    queryFn: () => getRolePermissions(userRoleId!),
    enabled: fetchUser && userRoleId != null,
  });

  useEffect(() => {
    if (roleFilter === "admin" && adminRolePermissions.length >= 0) {
      setSelectedPermissionIds(adminRolePermissions.map((p) => p.permission));
    } else if (roleFilter === "user" && userRolePermissions.length >= 0) {
      setSelectedPermissionIds(userRolePermissions.map((p) => p.permission));
    } else if (roleFilter === "all") {
      setAdminPermissionIds(adminRolePermissions.map((p) => p.permission));
      setUserPermissionIds(userRolePermissions.map((p) => p.permission));
    }
  }, [roleFilter, adminRolePermissions, userRolePermissions]);

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
      if (adminRoleId) queryClient.invalidateQueries({ queryKey: ["roles", adminRoleId, "permissions"] });
      if (userRoleId) queryClient.invalidateQueries({ queryKey: ["roles", userRoleId, "permissions"] });
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
      if (adminRoleId) queryClient.invalidateQueries({ queryKey: ["roles", adminRoleId, "permissions"] });
      if (userRoleId) queryClient.invalidateQueries({ queryKey: ["roles", userRoleId, "permissions"] });
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
    mutationFn: ({ roleId, permissionIds }: { roleId: number; permissionIds: number[] }) =>
      assignRolePermissions(roleId, { permission_ids: permissionIds }),
    onSuccess: (_, { roleId }) => {
      queryClient.invalidateQueries({ queryKey: ["roles", roleId, "permissions"] });
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

  const singleRoleId = roleFilter === "admin" ? adminRoleId : roleFilter === "user" ? userRoleId : null;

  const handleSaveAssignments = () => {
    if (singleRoleId == null) {
      toast({
        variant: "destructive",
        title: "Select a single role (Admin or User) to save",
      });
      return;
    }
    assignMutation.mutate({ roleId: singleRoleId, permissionIds: selectedPermissionIds });
  };

  const handleToggleForRole = (roleId: number, permissionId: number, assigned: boolean) => {
    if (roleId === adminRoleId) {
      const next = assigned ? [...adminPermissionIds, permissionId] : adminPermissionIds.filter((id) => id !== permissionId);
      setAdminPermissionIds(next);
      assignMutation.mutate({ roleId, permissionIds: next });
    } else if (roleId === userRoleId) {
      const next = assigned ? [...userPermissionIds, permissionId] : userPermissionIds.filter((id) => id !== permissionId);
      setUserPermissionIds(next);
      assignMutation.mutate({ roleId, permissionIds: next });
    }
  };

  if (!canViewRolePermissions) {
    return (
      <AppLayout title="Role Permissions" subtitle="Configure feature-level permissions for each role">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          You do not have permission to view role permissions.
        </div>
      </AppLayout>
    );
  }

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
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm text-muted-foreground">Show grid for:</span>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={roleFilter === "all"}
                    onCheckedChange={(checked) => {
                      if (checked) setRoleFilter("all");
                      setPage(1);
                    }}
                  />
                  <span className="text-sm">All roles</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={roleFilter === "admin"}
                    onCheckedChange={(checked) => {
                      if (checked) setRoleFilter("admin");
                      setPage(1);
                    }}
                  />
                  <span className="text-sm">Admin</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={roleFilter === "user"}
                    onCheckedChange={(checked) => {
                      if (checked) setRoleFilter("user");
                      setPage(1);
                    }}
                  />
                  <span className="text-sm">User</span>
                </label>
              </div>
            </div>
          }
          primaryAction={
            canUpdateRolePermissions ? (
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
            ) : null
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
                {roleFilter === "all" ? (
                  <>
                    <TableHead className="w-[140px]">Assigned to Admin</TableHead>
                    <TableHead className="w-[140px]">Assigned to User</TableHead>
                  </>
                ) : (
                  <TableHead className="w-[140px]">
                    Assigned to {roleFilter === "admin" ? "Admin" : "User"}
                  </TableHead>
                )}
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
                    colSpan={roleFilter === "all" ? 10 : 9}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Loading permissions...
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell
                    colSpan={roleFilter === "all" ? 10 : 9}
                    className="py-12 text-center text-destructive"
                  >
                    Failed to load permissions. Please try again.
                  </TableCell>
                </TableRow>
              ) : filteredPermissions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={roleFilter === "all" ? 10 : 9}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No permissions found.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedPermissions.map((permission, index) => {
                  const isAssignedSingle = selectedPermissionIds.includes(permission.id);
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
                          disabled={updateMutation.isPending || !canUpdateRolePermissions}
                        />
                      </TableCell>
                      {roleFilter === "all" ? (
                        <>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={adminPermissionIds.includes(permission.id)}
                                disabled={!adminRoleId || assignMutation.isPending || !canUpdateRolePermissions}
                                onCheckedChange={(value) =>
                                  handleToggleForRole(adminRoleId!, permission.id, Boolean(value))
                                }
                              />
                              <span className="text-xs text-muted-foreground">
                                {adminPermissionIds.includes(permission.id) ? "Yes" : "No"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={userPermissionIds.includes(permission.id)}
                                disabled={!userRoleId || assignMutation.isPending || !canUpdateRolePermissions}
                                onCheckedChange={(value) =>
                                  handleToggleForRole(userRoleId!, permission.id, Boolean(value))
                                }
                              />
                              <span className="text-xs text-muted-foreground">
                                {userPermissionIds.includes(permission.id) ? "Yes" : "No"}
                              </span>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={isAssignedSingle}
                              disabled={singleRoleId == null || assignMutation.isPending || !canUpdateRolePermissions}
                              onCheckedChange={(value) =>
                                toggleAssigned(permission.id, Boolean(value) as boolean)
                              }
                            />
                            <span className="text-xs text-muted-foreground">
                              {singleRoleId ? (isAssignedSingle ? "Yes" : "No") : "Select role above"}
                            </span>
                          </div>
                        </TableCell>
                      )}
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
                          {canUpdateRolePermissions && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-primary hover:text-primary"
                              title="Edit permission"
                              onClick={() => handleEditPermission(permission)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {canDeleteRolePermissions && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              title="Delete permission"
                              onClick={() => handleDeletePermission(permission)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
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
              {roleFilter === "all"
                ? "Check boxes to assign permissions to Admin or User. Changes save automatically."
                : singleRoleId
                  ? "Select permissions and click Save to assign to the role."
                  : "Select a role (All roles, Admin, or User) to view and assign permissions."}
            </div>
            {roleFilter !== "all" && canUpdateRolePermissions && (
              <Button
                size="sm"
                onClick={handleSaveAssignments}
                disabled={singleRoleId == null || assignMutation.isPending}
              >
                {assignMutation.isPending ? "Saving..." : "Save Permissions"}
              </Button>
            )}
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
