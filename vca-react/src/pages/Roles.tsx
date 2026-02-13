import React, { useState, useMemo } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  createRole,
  updateRole,
  deleteRole,
  type Role,
} from "@/services/userService";

type SortKey = "name" | "description" | "permission_count" | "status" | "created_date";

export default function Roles() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [sortKey, setSortKey] = useState<SortKey | null>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIsActive, setNewIsActive] = useState(true);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  const { data: roles = [], isLoading, error } = useQuery({
    queryKey: ["roles"],
    queryFn: getRoles,
  });

  const createMutation = useMutation({
    mutationFn: createRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast({ title: "Role created successfully" });
      setIsAddOpen(false);
      setNewName("");
      setNewDescription("");
      setNewIsActive(true);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Failed to create role",
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
      payload: Partial<Pick<Role, "name" | "description" | "is_active">>;
    }) => updateRole(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast({ title: "Role updated successfully" });
      setIsEditOpen(false);
      setEditingRole(null);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Failed to update role",
        description: "Please try again.",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast({ title: "Role deleted successfully" });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Failed to delete role",
        description: "Please try again.",
      });
    },
  });

  const filteredRoles = useMemo(() => {
    let list = roles.filter((r) => {
      const term = search.trim().toLowerCase();
      const matchesSearch =
        !term ||
        r.name.toLowerCase().includes(term) ||
        (r.description || "").toLowerCase().includes(term);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && r.is_active) ||
        (statusFilter === "inactive" && !r.is_active);
      return matchesSearch && matchesStatus;
    });
    if (sortKey) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case "name":
            cmp = a.name.localeCompare(b.name);
            break;
          case "description":
            cmp = (a.description || "").localeCompare(b.description || "");
            break;
          case "permission_count":
            cmp = a.permission_count - b.permission_count;
            break;
          case "status":
            cmp = (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0);
            break;
          case "created_date":
            cmp = new Date(a.created_date).getTime() - new Date(b.created_date).getTime();
            break;
          default:
            break;
        }
        return sortDir === "desc" ? -cmp : cmp;
      });
    }
    return list;
  }, [roles, search, statusFilter, sortKey, sortDir]);

  const paginatedRoles = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRoles.slice(start, start + pageSize);
  }, [filteredRoles, page, pageSize]);

  const handleSort = (key: string) => {
    const k = key as SortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(1);
  };

  const handleAddRole = () => {
    setNewName("");
    setNewDescription("");
    setNewIsActive(true);
    setIsAddOpen(true);
  };

  const handleEditRole = (role: Role) => {
    setEditingRole(role);
    setEditName(role.name);
    setEditDescription(role.description || "");
    setEditIsActive(role.is_active);
    setIsEditOpen(true);
  };

  const handleToggleStatus = (role: Role, next: boolean) => {
    updateMutation.mutate({
      id: role.id,
      payload: { is_active: next },
    });
  };

  const handleDelete = (role: Role) => {
    if (!window.confirm(`Delete role "${role.name}"?`)) return;
    deleteMutation.mutate(role.id);
  };

  return (
    <AppLayout
      title="Role List"
      subtitle="Manage application roles"
    >
      <div className="space-y-6 animate-fade-in">
        <TableToolbar
          searchPlaceholder="Search..."
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          filters={
            <Select
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
            </Select>
          }
          primaryAction={(
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button
                  onClick={handleAddRole}
                  disabled={createMutation.isPending}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {createMutation.isPending ? "Adding..." : "Add New Role"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form
                  onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
                    e.preventDefault();
                    if (!newName.trim()) return;
                    createMutation.mutate({
                      name: newName.trim(),
                      description: newDescription.trim(),
                      is_active: newIsActive,
                    });
                  }}
                >
                  <DialogHeader>
                    <DialogTitle>Create New Role</DialogTitle>
                    <DialogDescription>
                      Define a role name, description and whether it is active.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="role-name">Role Name</Label>
                      <Input
                        id="role-name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role-description">Description</Label>
                      <Input
                        id="role-description"
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        placeholder="Short description of this role"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Active</Label>
                        <p className="text-xs text-muted-foreground">
                          Only active roles can be assigned.
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
          )}
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
                  Name
                </SortableTableHead>
               {/* <SortableTableHead
                  sortKey="description"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Description
                </SortableTableHead>
                 <SortableTableHead
                  sortKey="permission_count"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Permissions
                </SortableTableHead> */}
                <SortableTableHead
                  sortKey="status"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Status
                </SortableTableHead>
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
                    colSpan={7}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Loading roles...
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-12 text-center text-destructive"
                  >
                    Failed to load roles. Please try again.
                  </TableCell>
                </TableRow>
              ) : filteredRoles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No roles found.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRoles.map((role, index) => (
                  <TableRow key={role.id} className="group">
                    <TableCell className="pl-6 font-medium">
                      {(page - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    {/* <TableCell className="max-w-xs truncate text-muted-foreground">
                      {role.description || "—"}
                    </TableCell> */}
                    {/* <TableCell>{role.permission_count}</TableCell> */}
                    <TableCell>
                      <Switch
                        checked={role.is_active}
                        onCheckedChange={(next) =>
                          handleToggleStatus(role, next)
                        }
                        disabled={updateMutation.isPending}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {role.created_date
                        ? new Date(role.created_date).toLocaleDateString(undefined, {
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
                          title="Edit role"
                          onClick={() => handleEditRole(role)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          title="Delete role"
                          onClick={() => handleDelete(role)}
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
          {/* Edit Role Dialog */}
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogContent>
              <form
                onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  if (!editingRole) return;
                  updateMutation.mutate({
                    id: editingRole.id,
                    payload: {
                      name: editName.trim(),
                      description: editDescription.trim(),
                      is_active: editIsActive,
                    },
                  });
                }}
              >
                <DialogHeader>
                  <DialogTitle>Edit Role</DialogTitle>
                  <DialogDescription>
                    Update role details. Changes will apply to all users with this role.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-role-name">Role Name</Label>
                    <Input
                      id="edit-role-name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-role-description">Description</Label>
                    <Input
                      id="edit-role-description"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Active</Label>
                      <p className="text-xs text-muted-foreground">
                        Deactivating prevents new assignments but keeps history.
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
                      setEditingRole(null);
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
            totalCount={filteredRoles.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            itemLabel="roles"
          />
        </Card>
      </div>
    </AppLayout>
  );
}
