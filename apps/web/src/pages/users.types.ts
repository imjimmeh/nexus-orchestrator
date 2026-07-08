export interface UserFormData {
  username: string;
  email: string;
  password?: string;
  role: "admin" | "user";
  isActive: boolean;
}
