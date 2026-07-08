import { Injectable, BadRequestException } from '@nestjs/common';
import * as yaml from 'js-yaml';

@Injectable()
export class YAMLValidationService {
  validateYAML(yamlString: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    try {
      const doc = yaml.load(yamlString);
      if (!doc || typeof doc !== 'object') {
        errors.push('YAML must evaluate to an object');
        return { valid: false, errors };
      }

      // Scan for malicious patterns in the raw string before parsing
      const maliciousPatterns = [
        /eval\(/i,
        /Function\(/i,
        /process\.env/i,
        /require\(/i,
      ];

      for (const pattern of maliciousPatterns) {
        if (pattern.test(yamlString)) {
          errors.push(
            `Forbidden pattern detected in YAML: ${pattern.toString()}`,
          );
        }
      }
    } catch (e) {
      const err = e as Error;
      errors.push(`Invalid YAML syntax: ${err.message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  validateAndThrow(yamlString: string): void {
    const { valid, errors } = this.validateYAML(yamlString);
    if (!valid) {
      throw new BadRequestException(
        `YAML security validation failed: ${errors.join(', ')}`,
      );
    }
  }
}
