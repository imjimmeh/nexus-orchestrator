import { z } from "zod";

export const TodoStatusSchema = z.enum([
  "not-started",
  "in-progress",
  "completed",
]);

export const TodoItemSchema = z
  .object({
    id: z.number().int().positive(),
    text: z.string().trim().min(1),
    status: TodoStatusSchema,
  })
  .strict();

export const ManageTodoListSchema = z
  .object({
    action: z.literal("manage_todo_list"),
    todo_action: z.enum(["add", "start", "complete", "list", "clear"]),
    text: z.string().trim().min(1).optional(),
    id: z.number().int().positive().optional(),
  })
  .strict();

export const GetTodoListSchema = z
  .object({
    action: z.literal("get_todo_list"),
  })
  .strict();

export const TodoStateUpdatePayloadSchema = z
  .object({
    todos: z.array(TodoItemSchema),
  })
  .strict();

export * from "./todo.types";
