import { z } from "zod";
import {
  TodoStatusSchema,
  TodoItemSchema,
  ManageTodoListSchema,
  GetTodoListSchema,
  TodoStateUpdatePayloadSchema,
} from "./todo.schemas";

export type TodoStatus = z.infer<typeof TodoStatusSchema>;
export type TodoItem = z.infer<typeof TodoItemSchema>;
export type ManageTodoListInput = z.infer<typeof ManageTodoListSchema>;
export type GetTodoListInput = z.infer<typeof GetTodoListSchema>;
export type TodoStateUpdatePayload = z.infer<
  typeof TodoStateUpdatePayloadSchema
>;
