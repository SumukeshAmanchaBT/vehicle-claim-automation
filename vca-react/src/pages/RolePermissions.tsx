import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit2, Trash2 } from "lucide-react";
import {
  DataTablePagination,
  SortableTableHead,
  TableToolbar,
  type SortDirection,
} from "@/components/data-table";

type PermissionRow = {
  id: number;
  role: string;
  module: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isActive: boolean;
};

const initialPermissions: PermissionRow[] = [
  {
    id: 1,
    role: "Admin",
    module: "User Management",
    canView: true,
    canCreate: true,
    canEdit: true,
    canDelete: true,
    isActive: true,
  },
  {
    id: 2,
    role: "Admin",
    module: "Master Data",
    canView: true,
    canCreate: true,
    canEdit: true,
    canDelete: true,
    isActive: true,
  },
  {
    id: 3,
    role: "Manufacturing Rep",
    module: "Claims",
    canView: true,
    canCreate: true,
    canEdit: false,
    canDelete: false,
    isActive: true,
  },
  {
    id: 4,
    role: "Inside Sales",
    module: "Reports",
    canView: true,
    canCreate: false,
    canEdit: false,
    canDelete: false,
    isActive: true,
  },
];

type PermissionSortKey = "role" | "module" | "status";

export default function RolePermissions() {
  const [permissions, setPermissions] =
    useState<PermissionRow[]>(initialPermissions);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] =
    useState<"all" | "active" | "inactive">("all");
  const [sortKey, setSortKey] = useState<PermissionSortKey | null>("role");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredPermissions = useMemo(() => {
    let list = permissions.filter((row) => {
      const term = search.toLowerCase();
      const matchesSearch =
        row.role.toLowerCase().includes(term) ||
        row.module.toLowerCase().includes(term);
      const matchesRole =
        roleFilter === "all" || row.role.toLowerCase() === roleFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? row.isActive : !row.isActive);
      return matchesSearch && matchesRole && matchesStatus;
    });

    if (sortKey) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case "role":
            cmp = a.role.localeCompare(b.role);
            break;
          case "module":
            cmp = a.module.localeCompare(b.module);
            break;
          case "status":
            cmp = Number(a.isActive) - Number(b.isActive);
            break;
          default:
            break;
        }
        return sortDir === "desc" ? -cmp : cmp;
      });
    }

    return list;
  }, [permissions, search, roleFilter, statusFilter, sortKey, sortDir]);

  const paginatedPermissions = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredPermissions.slice(start, start + pageSize);
  }, [filteredPermissions, page, pageSize]);

  const handleSort = (key: string) => {
    const k = key as PermissionSortKey;
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(1);
  };

  const handleToggleActive = (id: number, next: boolean) => {
    setPermissions((current) =>
      current.map((row) =>
        row.id === id ? { ...row, isActive: next } : row,
      ),
    );
  };

  return (
    <AppLayout
      title="Role Permissions"
      subtitle="Configure feature-level permissions for each role"
    >
      <div className="space-y-6 animate-fade-in">
        <TableToolbar
          searchPlaceholder="Search role permissions..."
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          filters={
            <div className="flex gap-3">
              <Select
                value={roleFilter}
                onValueChange={(value) => {
                  setRoleFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="apar sales executive">
                    Apar Sales Executive
                  </SelectItem>
                  <SelectItem value="manufacturing rep">
                    Manufacturing Rep
                  </SelectItem>
                  <SelectItem value="inside sales">Inside Sales</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as "all" | "active" | "inactive");
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
            </div>
          }
          primaryAction={(
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add New Permission
            </Button>
          )}
        />

        <Card className="card-elevated overflow-hidden border-none">
          <Table>
            <TableHeader className="table-header-bg">
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-6 w-16">SNo</TableHead>
                <SortableTableHead
                  sortKey="role"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Role Name
                </SortableTableHead>
                <SortableTableHead
                  sortKey="module"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Module
                </SortableTableHead>
                <TableHead>View</TableHead>
                <TableHead>Create</TableHead>
                <TableHead>Edit</TableHead>
                <TableHead>Delete</TableHead>
                <SortableTableHead
                  sortKey="status"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Status
                </SortableTableHead>
                <TableHead className="pr-6 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPermissions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No role permissions found.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedPermissions.map((row, index) => (
                  <TableRow key={row.id} className="group">
                    <TableCell className="pl-6">
                      {(page - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.role}
                    </TableCell>
                    <TableCell>{row.module}</TableCell>
                    <TableCell>
                      {row.canView ? "Yes" : "No"}
                    </TableCell>
                    <TableCell>
                      {row.canCreate ? "Yes" : "No"}
                    </TableCell>
                    <TableCell>
                      {row.canEdit ? "Yes" : "No"}
                    </TableCell>
                    <TableCell>
                      {row.canDelete ? "Yes" : "No"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={row.isActive}
                          onCheckedChange={(next) =>
                            handleToggleActive(row.id, next)
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          {row.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-foreground"
                          title="Edit permission"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          title="Delete permission"
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
