import { Injectable, Logger } from '@nestjs/common';

/** Known entry types in the pi-coding-agent v3 JSONL format. */
@Injectable()
export class JSONLValidationService {
  private readonly logger = new Logger(JSONLValidationService.name);

  validateJSONL(jsonlString: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const lines = jsonlString.split('\n');
    let lineNum = 0;

    for (const line of lines) {
      lineNum++;
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (!parsed.id) {
          errors.push(`Line ${lineNum}: Missing 'id' field`);
        }
        if (!parsed.type) {
          errors.push(`Line ${lineNum}: Missing 'type' field`);
        }
      } catch {
        errors.push(`Line ${lineNum}: Invalid JSON format`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate the tree structure of parsed JSONL nodes.
   * Supports both legacy `parent` field and v3 `parentId` field.
   */
  validateTreeStructure(nodes: Record<string, unknown>[]): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const nodeIds = new Set<string>();

    for (const node of nodes) {
      if (typeof node.id === 'string') {
        nodeIds.add(node.id);
      }
    }

    for (const node of nodes) {
      // Support both legacy `parent` and v3 `parentId`
      const parentRef = node.parentId ?? node.parent;

      if (
        parentRef &&
        typeof parentRef === 'string' &&
        !nodeIds.has(parentRef)
      ) {
        errors.push(
          `Node '${String(node.id)}' references unknown parent '${parentRef}'`,
        );
      }
    }

    // Basic cycle detection
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const getParent = (node: Record<string, unknown>): string | undefined => {
      const ref = node.parentId ?? node.parent;
      return typeof ref === 'string' ? ref : undefined;
    };

    const checkCycle = (nodeId: string): boolean => {
      if (!visited.has(nodeId)) {
        visited.add(nodeId);
        recStack.add(nodeId);

        const node = nodes.find((n) => n.id === nodeId);
        const parentRef = node ? getParent(node) : undefined;
        if (parentRef) {
          if (!visited.has(parentRef) && checkCycle(parentRef)) {
            return true;
          } else if (recStack.has(parentRef)) {
            return true;
          }
        }
      }
      recStack.delete(nodeId);
      return false;
    };

    for (const nodeId of nodeIds) {
      if (checkCycle(nodeId)) {
        errors.push(`Cycle detected involving node '${nodeId}'`);
        break; // One cycle error is enough
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
