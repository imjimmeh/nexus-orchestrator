import type * as React from "react";
import {
  Users as UsersIcon,
  Plus,
  Pencil,
  Trash2,
  Lock,
  UserX,
  UserCheck,
  Search,
} from "lucide-react";
import type { UserResponse } from "@nexus/core";
import { formatDateSafe } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { UserFormData } from "./users.types";

function getRoleBadgeVariant(
  role: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (role === "admin") {
    return "destructive";
  }

  if (role === "user") {
    return "secondary";
  }

  return "outline";
}

function getStatusBadgeVariant(
  isActive: boolean,
): "default" | "secondary" | "destructive" | "outline" {
  return isActive ? "default" : "secondary";
}

interface UsersCreateDialogProps {
  open: boolean;
  formData: UserFormData;
  createPending: boolean;
  onOpenChange: (open: boolean) => void;
  onFormDataChange: (next: UserFormData) => void;
  onSubmit: (event: React.SyntheticEvent) => void;
}

export function UsersCreateDialog({
  open,
  formData,
  createPending,
  onOpenChange,
  onFormDataChange,
  onSubmit,
}: Readonly<UsersCreateDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create User
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              Add a new user to the system. They will receive an email with
              their login credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(event) =>
                  onFormDataChange({
                    ...formData,
                    username: event.target.value,
                  })
                }
                placeholder="johndoe"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(event) =>
                  onFormDataChange({
                    ...formData,
                    email: event.target.value,
                  })
                }
                placeholder="john@example.com"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(event) =>
                  onFormDataChange({
                    ...formData,
                    password: event.target.value,
                  })
                }
                placeholder="••••••••"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={formData.role}
                onValueChange={(value: "admin" | "user") =>
                  onFormDataChange({ ...formData, role: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createPending}>
              {createPending ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface UsersRowsProps {
  users: UserResponse[];
  isLoading: boolean;
  onOpenEdit: (user: UserResponse) => void;
  onOpenDelete: (user: UserResponse) => void;
  onOpenResetPassword: (user: UserResponse) => void;
  onToggleStatus: (user: UserResponse) => void;
}

function UsersRows({
  users,
  isLoading,
  onOpenEdit,
  onOpenDelete,
  onOpenResetPassword,
  onToggleStatus,
}: Readonly<UsersRowsProps>) {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-center">
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (users.length === 0) {
    return (
      <TableRow>
        <TableCell
          colSpan={6}
          className="py-8 text-center text-muted-foreground"
        >
          <UsersIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
          No users found
        </TableCell>
      </TableRow>
    );
  }

  return users.map((user) => (
    <TableRow key={user.id}>
      <TableCell className="font-medium">{user.username}</TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        {user.roles?.map((role) => (
          <Badge
            key={role}
            variant={getRoleBadgeVariant(role)}
            className="mr-1"
          >
            {role}
          </Badge>
        ))}
      </TableCell>
      <TableCell>
        <Badge variant={getStatusBadgeVariant(user.isActive)}>
          {user.isActive ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell>
        {formatDateSafe(user.createdAt, "MMM d, yyyy", "Unknown date")}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenEdit(user)}
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenResetPassword(user)}
            title="Reset Password"
          >
            <Lock className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onToggleStatus(user)}
            title={user.isActive ? "Disable" : "Enable"}
          >
            {user.isActive ? (
              <UserX className="h-4 w-4" />
            ) : (
              <UserCheck className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenDelete(user)}
            title="Delete"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  ));
}

interface UsersTableCardProps {
  users: UserResponse[];
  isLoading: boolean;
  page: number;
  search: string;
  roleFilter: "all" | "admin" | "user";
  statusFilter: "all" | "active" | "inactive";
  meta?: {
    total: number;
    totalPages: number;
  };
  onPageChange: (nextPage: number) => void;
  onSearchChange: (value: string) => void;
  onRoleFilterChange: (value: "all" | "admin" | "user") => void;
  onStatusFilterChange: (value: "all" | "active" | "inactive") => void;
  onOpenEdit: (user: UserResponse) => void;
  onOpenDelete: (user: UserResponse) => void;
  onOpenResetPassword: (user: UserResponse) => void;
  onToggleStatus: (user: UserResponse) => void;
}

export function UsersTableCard({
  users,
  isLoading,
  page,
  search,
  roleFilter,
  statusFilter,
  meta,
  onPageChange,
  onSearchChange,
  onRoleFilterChange,
  onStatusFilterChange,
  onOpenEdit,
  onOpenDelete,
  onOpenResetPassword,
  onToggleStatus,
}: Readonly<UsersTableCardProps>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>View and manage all system users</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-col gap-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex gap-2">
            <Select value={roleFilter} onValueChange={onRoleFilterChange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={onStatusFilterChange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[200px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <UsersRows
                users={users}
                isLoading={isLoading}
                onOpenEdit={onOpenEdit}
                onOpenDelete={onOpenDelete}
                onOpenResetPassword={onOpenResetPassword}
                onToggleStatus={onToggleStatus}
              />
            </TableBody>
          </Table>
        </div>

        {meta && meta.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {users.length} of {meta.total} users
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <span className="text-sm">
                Page {page} of {meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onPageChange(Math.min(meta.totalPages, page + 1))
                }
                disabled={page >= meta.totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
