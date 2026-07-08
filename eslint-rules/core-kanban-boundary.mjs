const BOUNDARY_ROOTS = ["/apps/api/src/", "/packages/core/src/"];

const FORBIDDEN_PATTERNS = [
  { id: "kanban", pattern: /kanban/iu },
  { id: "legacy-kanban", pattern: /LegacyKanban/u },
  { id: "work-item-camel", pattern: /workItem|WorkItem/u },
  { id: "work-item-snake", pattern: /work_item/u },
  { id: "work-item-kebab", pattern: /work-item/u },
  { id: "project-id-snake", pattern: /project_id/u },
  { id: "project-id-camel", pattern: /projectId/u },
  { id: "kanban-contracts-import", pattern: /@nexus\/kanban-contracts/u },
];

function normalizePath(filename) {
  return filename.replaceAll("\\", "/");
}

function isBoundaryFile(filename) {
  const normalized = normalizePath(filename);
  return BOUNDARY_ROOTS.some((root) => normalized.includes(root));
}

function locationForIndex(sourceCode, index) {
  return sourceCode.getLocFromIndex(index);
}

export const coreKanbanBoundaryRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Kanban/work-item/project-domain residue in API and core boundary roots.",
    },
    messages: {
      forbiddenResidue:
        "Core/API boundary must not contain '{{term}}'. Move Kanban domain ownership to apps/kanban or use neutral scope/context/resource language.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.physicalFilename ?? "";
    if (!isBoundaryFile(filename)) {
      return {};
    }

    return {
      Program(node) {
        const sourceCode = context.sourceCode;
        const text = sourceCode.getText();

        for (const forbidden of FORBIDDEN_PATTERNS) {
          forbidden.pattern.lastIndex = 0;
          const match = forbidden.pattern.exec(text);
          if (!match || match.index < 0) {
            continue;
          }

          context.report({
            node,
            loc: locationForIndex(sourceCode, match.index),
            messageId: "forbiddenResidue",
            data: { term: match[0] },
          });
        }
      },
    };
  },
};

export const coreKanbanBoundaryPlugin = {
  rules: {
    "no-core-kanban-residue": coreKanbanBoundaryRule,
  },
};
