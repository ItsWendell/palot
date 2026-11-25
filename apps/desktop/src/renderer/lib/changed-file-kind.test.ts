import { describe, expect, it } from "vitest";
import {
  classifyChangedFile,
  describeQuietFiles,
  orderQuietLast,
  parseGeneratedAttributes,
  summarizeChanges,
} from "./changed-file-kind";

describe("classifyChangedFile", () => {
  it.each([
    // Lockfiles, at the root or in a package.
    ["bun.lock", "lockfile"],
    ["apps/web/package-lock.json", "lockfile"],
    ["yarn.lock", "lockfile"],
    ["pnpm-lock.yaml", "lockfile"],
    ["crates/core/Cargo.lock", "lockfile"],
    ["go.sum", "lockfile"],
    ["poetry.lock", "lockfile"],
    ["uv.lock", "lockfile"],
    ["Gemfile.lock", "lockfile"],
    ["composer.lock", "lockfile"],
    ["ios/Podfile.lock", "lockfile"],
    ["flake.lock", "lockfile"],
    // Generated names and output folders.
    ["src/renderer/routeTree.gen.ts", "generated"],
    ["src/api/client.generated.ts", "generated"],
    ["pkg/apis/zz_generated.deepcopy.go", "generated"],
    ["proto/user.pb.go", "generated"],
    ["proto/user_pb2.py", "generated"],
    ["web/src/gen/user_pb.d.ts", "generated"],
    ["public/vendor.min.js", "generated"],
    ["public/app.js.map", "generated"],
    ["packages/ui/dist/index.js", "generated"],
    ["build/output.css", "generated"],
    ["src/__generated__/schema.ts", "generated"],
    ["src/__snapshots__/view.test.tsx.snap", "generated"],
    ["tests/output.snap", "generated"],
    // Migrations, including Palot's own drizzle folders.
    ["db/migrations/0001_init.sql", "migration"],
    ["prisma/migrations/20240101_init/migration.sql", "migration"],
    ["apps/desktop/drizzle/20260821013413_glamorous_vermin/migration.sql", "migration"],
    ["apps/desktop/drizzle/20260821013413_glamorous_vermin/snapshot.json", "migration"],
    ["db/migrate/20240101000000_create_users.rb", "migration"],
    ["app/migrations/0002_auto.py", "migration"],
    // Tests stay open, but carry a label.
    ["src/lib/format.test.ts", "test"],
    ["src/components/button.spec.tsx", "test"],
    ["src/__tests__/format.ts", "test"],
    ["test/helpers.ts", "test"],
    ["apps/desktop/test/e2e/opencode-api-migration-scenario.ts", "test"],
    ["e2e/login.ts", "test"],
    ["server/handler_test.go", "test"],
    ["tests/test_api.py", "test"],
    ["spec/models/user_spec.rb", "test"],
    ["src/test/java/com/acme/UserServiceTest.java", "test"],
    // False positives to avoid.
    ["src/build-info.ts", "regular"],
    ["docs/testing.md", "regular"],
    ["scripts/build.ts", "regular"],
    ["apps/desktop/drizzle.config.ts", "regular"],
    ["src/db/drizzle/schema.ts", "regular"],
    ["src/lib/latest.ts", "regular"],
    ["openapi.spec.yaml", "regular"],
    ["src/lockfile.ts", "regular"],
    ["src/generator.ts", "regular"],
    ["README.md", "regular"],
  ])("%s is %s", (path, kind) => {
    expect(classifyChangedFile(path)).toBe(kind);
  });
});

describe("parseGeneratedAttributes", () => {
  const rules = parseGeneratedAttributes(
    [
      "# Generated clients",
      "* text=auto eol=lf",
      "api/client/** linguist-generated",
      "*.pbxproj linguist-generated=true",
      "/schema.graphql linguist-generated",
      "**/fixtures/*.json linguist-generated=true",
      "src/renderer/routeTree.gen.ts -linguist-generated",
      "dist/keep.js linguist-generated=false",
      "ignored-dir/ linguist-generated",
    ].join("\n"),
  );

  it("marks matching paths generated", () => {
    expect(classifyChangedFile("api/client/index.ts", rules)).toBe("generated");
    expect(classifyChangedFile("ios/App.xcodeproj/project.pbxproj", rules)).toBe("generated");
    expect(classifyChangedFile("schema.graphql", rules)).toBe("generated");
    expect(classifyChangedFile("a/b/fixtures/users.json", rules)).toBe("generated");
  });

  it("anchors patterns that contain a slash", () => {
    expect(classifyChangedFile("nested/api/client/index.ts", rules)).toBe("regular");
    expect(classifyChangedFile("nested/schema.graphql", rules)).toBe("regular");
  });

  it("lets unset attributes override the built-in rules", () => {
    expect(classifyChangedFile("src/renderer/routeTree.gen.ts", rules)).toBe("regular");
    expect(classifyChangedFile("dist/keep.js", rules)).toBe("regular");
    expect(classifyChangedFile("dist/other.js", rules)).toBe("generated");
  });

  it("keeps lockfiles and ignores directory patterns, which Git does not match", () => {
    expect(
      classifyChangedFile("bun.lock", parseGeneratedAttributes("bun.lock -linguist-generated")),
    ).toBe("lockfile");
    expect(classifyChangedFile("ignored-dir/file.ts", rules)).toBe("regular");
  });
});

describe("summaries", () => {
  it("counts regular and test files apart from quiet ones", () => {
    const summary = summarizeChanges([
      { kind: "regular", additions: 10, deletions: 2 },
      { kind: "test", additions: 5, deletions: 0 },
      { kind: "lockfile", additions: 300, deletions: 120 },
      { kind: "generated", additions: 40, deletions: 40 },
      { kind: "generated", additions: 1, deletions: 1 },
    ]);
    expect(summary.main).toEqual({ files: 2, additions: 15, deletions: 2 });
    expect(summary.quiet).toEqual({
      files: 3,
      additions: 341,
      deletions: 161,
      kinds: { lockfile: 1, generated: 2, migration: 0 },
    });
    expect(describeQuietFiles(summary.quiet.kinds)).toBe("1 lockfile, 2 generated");
    expect(describeQuietFiles({ lockfile: 2, generated: 0, migration: 1 })).toBe(
      "2 lockfiles, 1 migration",
    );
  });

  it("orders quiet files last and keeps each group's order", () => {
    const paths = ["bun.lock", "src/a.ts", "dist/a.js", "src/a.test.ts", "src/b.ts"];
    expect(orderQuietLast(paths, (path) => classifyChangedFile(path))).toEqual([
      "src/a.ts",
      "src/a.test.ts",
      "src/b.ts",
      "bun.lock",
      "dist/a.js",
    ]);
  });
});
