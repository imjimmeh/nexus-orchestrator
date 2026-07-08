import { Logger } from "@nestjs/common";
import { DataSource } from "typeorm";

const WORK_ITEM_RESOURCE = "work_items";
const WORK_ITEM_ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "manage",
] as const;

const ROLE_GRANTS: Record<string, readonly string[]> = {
  admin: WORK_ITEM_ACTIONS,
  platform_admin: WORK_ITEM_ACTIONS,
  viewer: ["read"],
};

export async function seedKanbanPermissions(
  dataSource: DataSource,
): Promise<void> {
  const logger = new Logger("seedKanbanPermissions");

  for (const action of WORK_ITEM_ACTIONS) {
    const name = `${WORK_ITEM_RESOURCE}:${action}`;
    await dataSource.query(
      `INSERT INTO permissions (id, name, resource, action)
       VALUES (gen_random_uuid(), $1, $2, $3)
       ON CONFLICT (name) DO NOTHING`,
      [name, WORK_ITEM_RESOURCE, action],
    );
  }

  for (const [roleName, actions] of Object.entries(ROLE_GRANTS)) {
    for (const action of actions) {
      const permName = `${WORK_ITEM_RESOURCE}:${action}`;
      await dataSource.query(
        `INSERT INTO role_permissions (id, role_id, permission_id)
         SELECT gen_random_uuid(), r.id, p.id
         FROM roles r
         JOIN permissions p ON p.name = $1
         WHERE r.name = $2
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = r.id AND rp.permission_id = p.id
           )`,
        [permName, roleName],
      );
    }
  }

  logger.log("Kanban permission seeding complete");
}
