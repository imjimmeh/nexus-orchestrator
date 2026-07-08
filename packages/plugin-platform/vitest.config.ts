import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "strip-nestjs-decorators",
      transform(code, id) {
        if (id.includes("node_modules")) return;
        // Vitest's oxc transformer does not support TypeScript decorators.
        // Strip @Injectable() decorators so that NestJS-decorated classes
        // used in the platform package can be imported in tests.
        if (code.includes("@Injectable()")) {
          return code.replace(
            /@Injectable\(\s*\)\s*/g,
            "// @Injectable() stripped for vitest\n",
          );
        }
      },
    },
  ],
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.integration.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts", "**/dist/**", "**/node_modules/**"],
    },
  },
});
