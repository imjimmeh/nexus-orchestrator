import { Test } from '@nestjs/testing';
import { SystemPromptAssemblyModule } from './system-prompt-assembly.module';
import { SystemPromptAssemblyService } from './system-prompt-assembly.service';

describe('SystemPromptAssemblyModule', () => {
  it('provides SystemPromptAssemblyService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SystemPromptAssemblyModule],
    }).compile();
    expect(moduleRef.get(SystemPromptAssemblyService)).toBeInstanceOf(
      SystemPromptAssemblyService,
    );
  });
});
