import { useState } from "react";
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
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Search, UserPlus, Edit2, Shield, KeyRound, UserX } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Switch } from "@/components/ui/switch";
import {
  listUsers,
  createUser,
  updateUser,
  changeUserRole,
  resetUserPassword,
  deactivateUser,
  type UserSummary,
  type UserRole,
} from "@/services/userService";
import { isAxiosError } from "axios";

const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  user: "User",
};

function getDisplayName(user: UserSummary) {
  const full = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  return full || user.username;
}

export default function Users() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Add user form state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("user");

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
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
      setNewRole("user");
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
    mutationFn: ({ id, role }: { id: number; role: UserRole }) =>
      changeUserRole(id, { role }),
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

  const filteredUsers = users.filter((user) => {
    const term = search.toLowerCase();
    return (
      getDisplayName(user).toLowerCase().includes(term) ||
      user.email.toLowerCase().includes(term)
    );
  });

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword || !newEmail) return;
    createMutation.mutate({
      username: newUsername,
      password: newPassword,
      email: newEmail,
      first_name: newFirstName,
      last_name: newLastName,
      role: newRole,
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

  const handleChangeRole = (user: UserSummary) => {
    const nextRole: UserRole = user.role === "admin" ? "user" : "admin";
    if (
      !window.confirm(
        `Change role for ${getDisplayName(user)} to ${roleLabels[nextRole]}?`
      )
    ) {
      return;
    }
    changeRoleMutation.mutate({ id: user.id, role: nextRole });
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
        `${user.status === "active" ? "Deactivate" : "Activate"} ${
          getDisplayName(user)
        }?`
      )
    ) {
      return;
    }
    deactivateMutation.mutate(user.id);
  };

  return (
    <AppLayout
      title="User Management"
      subtitle="Manage system users and permissions"
    >
      <div className="space-y-6 animate-fade-in">
        {/* Filters & Add */}
        <Card className="card-elevated">
          <CardContent className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add User
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
                      <div className="space-y-2">
                        <Label htmlFor="role">Role</Label>
                        <Select
                          value={newRole}
                          onValueChange={(val: UserRole) => setNewRole(val)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="user">User</SelectItem>
                          </SelectContent>
                        </Select>
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
            </div>
          </CardContent>
        </Card>

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
            <Table>
              <TableHeader className="table-header-bg">
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-6">User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Claims Handled</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
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
                        {roleLabels[user.role]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={user.status === "active"}
                          // Backend only supports deactivation; once inactive we keep it off.
                          disabled={user.status !== "active"}
                          onCheckedChange={(next) => {
                            if (!next && user.status === "active") {
                              handleDeactivate(user);
                            }
                          }}
                        />
                        <span className="text-xs text-muted-foreground">
                          {user.status === "active" ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.claims_handled}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.last_login
                        ? new Date(user.last_login).toLocaleString()
                        : "-"}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex items-center justify-end gap-1">
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
                          onClick={() => handleChangeRole(user)}
                        >
                          <Shield className="h-4 w-4" />
                        </Button>
                        {/* <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-foreground"
                          title="Reset password"
                          onClick={() => handleResetPassword(user)}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button> */}
                        {/* <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          title={
                            user.status === "active"
                              ? "Deactivate user"
                              : "User already inactive"
                          }
                          disabled={user.status !== "active"}
                          onClick={() => handleDeactivate(user)}
                        >
                          <UserX className="h-4 w-4" />
                        </Button> */}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}

