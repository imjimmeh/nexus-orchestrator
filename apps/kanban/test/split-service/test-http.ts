import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";

export async function listenOnRandomPort(
  app: INestApplication,
): Promise<string> {
  await app.listen(0, "127.0.0.1");
  const server = app.getHttpServer() as { address: () => AddressInfo };
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}
