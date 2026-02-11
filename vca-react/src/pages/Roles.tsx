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

type RoleRow = {
  id: number;
  name: string;
  isActive: boolean;
};

const initialRoles: RoleRow[] = [
  { id: 1, name: "Admin", isActive: true },
  { id: 2, name: "Apar Sales Executive", isActive: true },
  { id: 3, name: "Manufacturing Rep", isActive: true },
  { id: 4, name: "Inside Sales", isActive: true },
];

type RoleSortKey = "sno" | "name" | "status";

export default function Roles() {
  const [roles, setRoles] = useState<RoleRow[]>(initialRoles);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [sortKey, setSortKey] = useState<RoleSortKey | null>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredRoles = useMemo(() => {
    let list = roles.filter((role) => {
      const term = search.toLowerCase();
      const matchesSearch = role.name.toLowerCase().includes(term);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? role.isActive : !role.isActive);
      return matchesSearch && matchesStatus;
    });

    if (sortKey) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case "sno":
            cmp = a.id - b.id;
            break;
          case "name":
            cmp = a.name.localeCompare(b.name);
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
  }, [roles, search, statusFilter, sortKey, sortDir]);

  const paginatedRoles = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRoles.slice(start, start + pageSize);
  }, [filteredRoles, page, pageSize]);

  const handleSort = (key: string) => {
    const k = key as RoleSortKey;
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "sno" ? "asc" : "asc");
    }
    setPage(1);
  };

  const handleToggleActive = (id: number, next: boolean) => {
    setRoles((current) =>
      current.map((role) =>
        role.id === id ? { ...role, isActive: next } : role,
      ),
    );
  };

  return (
    <AppLayout
      title="Role List"
      subtitle="Manage application roles"
    >
      <div className="space-y-6 animate-fade-in">
        <TableToolbar
          searchPlaceholder="Search roles..."
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          filters={
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
          }
          primaryAction={(
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add New Role
            </Button>
          )}
        />

        <Card className="card-elevated overflow-hidden border-none">
          <Table>
            <TableHeader className="table-header-bg">
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <SortableTableHead
                  sortKey="sno"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                  className="pl-6 w-20"
                >
                  SNo
                </SortableTableHead>
                <SortableTableHead
                  sortKey="name"
                  currentSortKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                >
                  Role Name
                </SortableTableHead>
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
              {filteredRoles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No roles found.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRoles.map((role, index) => (
                  <TableRow key={role.id} className="group">
                    <TableCell className="pl-6">
                      {(page - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {role.name}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={role.isActive}
                          onCheckedChange={(next) =>
                            handleToggleActive(role.id, next)
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          {role.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-foreground"
                          title="Edit role"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          title="Delete role"
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
