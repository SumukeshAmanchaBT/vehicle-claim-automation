import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, Edit2, Shield, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Switch } from "@/components/ui/switch";
import {
  TableToolbar,
  DataTablePagination,
  SortableTableHead,
  type SortDirection,
} from "@/components/data-table";
import {
  listUsers,
  createUser,
  updateUser,
  changeUserRole,
  resetUserPassword,
  deactivateUser,
  activateUser,
  softDeleteUser,
  getRoles,
  type UserSummary,
  type Role,
} from "@/services/userService";
import { isAxiosError } from "axios";
import { useAuth } from "@/contexts/AuthContext";

function getDisplayName(user: UserSummary) {
  const full = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  return full || user.username;
}

type SortKey = "user" | "role" | "status";

export default function Users() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission, isAdmin } = useAuth();
  const canViewUsers = hasPermission("users.view");
  const canAddUser = hasPermission("users.add");
  const canUpdateUser = hasPermission("users.update");
  const canDeleteUser = hasPermission("users.delete");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>("user");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Add user form state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newRoleId, setNewRoleId] = useState<number | "none">("none");

  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  const [roleUser, setRoleUser] = useState<UserSummary | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | "none">("none");

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    enabled: canViewUsers,
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: getRoles,
  });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setIsAddOpen(false);
      setNewUsername("");
      setNewPassword("");
      setNewEmail("");
      setNewFirstName("");
      setNewLastName("");
      setNewRoleId("none");
      toast({ title: "User created successfully" });
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 403) {
        const msg =
          (err.response?.data as { error?: string })?.error ||
          "You don’t have permission to create users.";
        toast({
          variant: "destructive",
          title: "Cannot create user",
          description: `${msg} Grant your account the Admin role by running: python manage.py make_admin <your_username>`,
        });
        return;
      }
      toast({
        variant: "destructive",
        title: "Failed to create user",
        description: isAxiosError(err) && err.message ? err.message : "Please try again.",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Partial<Pick<UserSummary, "email" | "first_name" | "last_name">>;
    }) => updateUser(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ id, role_id }: { id: number; role_id: number | null }) =>
      changeUserRole(id, { role_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      resetUserPassword(id, { new_password: newPassword }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => deactivateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => activateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "User activated" });
    },
  });

  const softDeleteMutation = useMutation({
    mutationFn: (id: number) => softDeleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "User removed from list" });
    },
  });

  const filteredUsers = useMemo(() => {
    let list = users.filter((user) => {
      const term = search.toLowerCase();
      const matchesSearch =
        getDisplayName(user).toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term);
      const roleName = user.role?.name?.toLowerCase() ?? "";
      const matchesRole =
        roleFilter === "all" ||
        (roleFilter === "with-role" && !!user.role) ||
        (roleFilter === "without-role" && !user.role) ||
        (roleFilter === roleName);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && user.is_active) ||
        (statusFilter === "inactive" && !user.is_active);
      return matchesSearch && matchesRole && matchesStatus;
    });
    if (sortKey) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case "user":
            cmp = getDisplayName(a).localeCompare(getDisplayName(b));
            break;
          case "role":
            cmp = (a.role?.name ?? "").localeCompare(b.role?.name ?? "");
            break;
          case "status":
            cmp = Number(a.is_active) - Number(b.is_active);
            break;
          default:
            break;
        }
        return sortDir === "desc" ? -cmp : cmp;
      });
    }
    return list;
  }, [users, search, roleFilter, statusFilter, sortKey, sortDir]);

  const handleSort = (key: string) => {
    const k = key as SortKey;
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(1);
  };

  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, page, pageSize]);

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword || !newEmail) return;
    createMutation.mutate({
      username: newUsername,
      password: newPassword,
      email: newEmail,
      first_name: newFirstName,
      last_name: newLastName,
      // backend create endpoint still expects legacy role; omit for now
    });
  };

  const handleEditUserInline = (user: UserSummary) => {
    const nextEmail = window.prompt("Email", user.email);
    if (nextEmail === null) return;
    const nextFirst = window.prompt("First name", user.first_name || "");
    if (nextFirst === null) return;
    const nextLast = window.prompt("Last name", user.last_name || "");
    if (nextLast === null) return;
    updateMutation.mutate({
      id: user.id,
      payload: {
        email: nextEmail,
        first_name: nextFirst,
        last_name: nextLast,
      },
    });
  };

  const handleOpenRoleDialog = (user: UserSummary) => {
    setRoleUser(user);
    setSelectedRoleId(user.role?.id ?? "none");
    setIsRoleDialogOpen(true);
  };

  const handleResetPassword = (user: UserSummary) => {
    const newPassword = window.prompt(
      `Enter new password for ${getDisplayName(user)}`
    );
    if (!newPassword) return;
    resetPasswordMutation.mutate({ id: user.id, newPassword });
  };

  const handleDeactivate = (user: UserSummary) => {
    if (
      !window.confirm(
        `Deactivate ${getDisplayName(user)}? They will no longer be able to sign in.`
      )
    ) {
      return;
    }
    deactivateMutation.mutate(user.id);
  };

  const handleActivate = (user: UserSummary) => {
    activateMutation.mutate(user.id);
  };

  const handleSoftDelete = (user: UserSummary) => {
    if (
      !window.confirm(
        `Delete ${getDisplayName(user)}? They will be removed from the user list.`
      )
    ) {
      return;
    }
    softDeleteMutation.mutate(user.id);
  };

  if (!canViewUsers) {
    return (
      <AppLayout title="Users List" subtitle="Manage system users and permissions">
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              You don’t have permission to view users. Your role must have the &quot;View Users&quot; permission.
            </p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Users List"
      subtitle="Manage system users and permissions"
    >
      <div className="space-y-6 animate-fade-in">
        <TableToolbar
          searchPlaceholder="Search users..."
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          filters={
            <>
              <Select
                value={roleFilter}
                onValueChange={(v) => {
                  setRoleFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="with-role">With Role</SelectItem>
                  <SelectItem value="without-role">Without Role</SelectItem>
                  {roles.map((role: Role) => (
                    <SelectItem key={role.id} value={role.name.toLowerCase()}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            </>
          }
          primaryAction={
            canAddUser ? (
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Add New User
                </Button>
              </DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleCreateUser}>
                    <DialogHeader>
                      <DialogTitle>Add New User</DialogTitle>
                      <DialogDescription>
                        Create a new user account.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <Input
                          id="username"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password">Temporary Password</Label>
                        <Input
                          id="password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="first_name">First name</Label>
                          <Input
                            id="first_name"
                            value={newFirstName}
                            onChange={(e) => setNewFirstName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="last_name">Last name</Label>
                          <Input
                            id="last_name"
                            value={newLastName}
                            onChange={(e) => setNewLastName(e.target.value)}
                          />
                        </div>
                      </div>
                      {/* Optional role assignment can be handled via core assign-role API after creation */}
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsAddOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={createMutation.isPending}
                      >
                        {createMutation.isPending ? "Creating..." : "Create"}
                      </Button>
                    </DialogFooter>
                  </form>
              </DialogContent>
            </Dialog>
            ) : null
          }
        />

        {/* Users Table */}
        <Card className="card-elevated overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">
              Loading users...
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">
              Failed to load users.
            </div>
          ) : (
            <>
              <Table>
                <TableHeader className="table-header-bg">
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <SortableTableHead
                      sortKey="user"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                      className="pl-6"
                    >
                      User
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="role"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    >
                      Role
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="status"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    >
                      Status
                    </SortableTableHead>
                    {/* <SortableTableHead
                      sortKey="claims"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    >
                      Claims Handled
                    </SortableTableHead>
                    <SortableTableHead
                      sortKey="lastLogin"
                      currentSortKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                    >
                      Last Login
                    </SortableTableHead> */}
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedUsers.map((user) => (
                  <TableRow key={user.id} className="group">
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                          {getDisplayName(user)
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">{getDisplayName(user)}</p>
                          <p className="text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
                        {user.role?.name ?? "No role"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={user.is_active}
                          onCheckedChange={(next) => {
                            if (next && !user.is_active) {
                              handleActivate(user);
                            } else if (!next && user.is_active) {
                              handleDeactivate(user);
                            }
                          }}
                        />
                        <span className="text-xs text-muted-foreground">
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </TableCell>
                    {/* <TableCell className="text-muted-foreground">
                      {user.claims_handled}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.last_login
                        ? new Date(user.last_login).toLocaleString()
                        : "-"}
                    </TableCell> */}
                    <TableCell className="pr-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canUpdateUser && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-foreground"
                              title="Edit user"
                              onClick={() => handleEditUserInline(user)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-foreground"
                              title="Change role"
                              onClick={() => handleOpenRoleDialog(user)}
                            >
                              <Shield className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {canDeleteUser && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            title="Delete user (remove from list)"
                            onClick={() => handleSoftDelete(user)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                </TableBody>
              </Table>
              <DataTablePagination
                totalCount={filteredUsers.length}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                itemLabel="users"
              />
              {/* Change Role Dialog */}
              <Dialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
                <DialogContent>
                  <form
                    onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
                      e.preventDefault();
                      if (!roleUser) return;
                      const role_id =
                        selectedRoleId === "none" ? null : Number(selectedRoleId);
                      changeRoleMutation.mutate({
                        id: roleUser.id,
                        role_id,
                      });
                      setIsRoleDialogOpen(false);
                    }}
                  >
                    <DialogHeader>
                      <DialogTitle>Assign Role</DialogTitle>
                      <DialogDescription>
                        Choose a role to assign to{" "}
                        {roleUser ? getDisplayName(roleUser) : "this user"}.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="assign-role">Role</Label>
                        <Select
                          value={
                            selectedRoleId === "none"
                              ? "none"
                              : String(selectedRoleId)
                          }
                          onValueChange={(val) => {
                            setSelectedRoleId(
                              val === "none" ? "none" : Number(val)
                            );
                          }}
                        >
                          <SelectTrigger id="assign-role">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Role</SelectItem>
                            {roles.map((role: Role) => (
                              <SelectItem key={role.id} value={String(role.id)}>
                                {role.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsRoleDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={changeRoleMutation.isPending}>
                        {changeRoleMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}

