import { Test, TestingModule } from '@nestjs/testing';
import { StateMachineService } from './state-machine.service';

describe('StateMachineService', () => {
  let service: StateMachineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StateMachineService],
    }).compile();

    service = module.get<StateMachineService>(StateMachineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should evaluate true condition and return next', () => {
    const next = service.evaluateTransition(
      [{ condition: 'output.passed == true', next: 'step_2' }],
      { output: { passed: true } },
    );
    expect(next).toBe('step_2');
  });

  it('should return null if no condition is met', () => {
    const next = service.evaluateTransition(
      [{ condition: 'output.passed == true', next: 'step_2' }],
      { output: { passed: false } },
    );
    expect(next).toBeNull();
  });

  it('should throw when a condition cannot be evaluated', () => {
    expect(() =>
      service.evaluateTransition(
        [{ condition: 'output.passed ===', next: 'step_2' }],
        { output: { passed: true } },
      ),
    ).toThrow('Failed to evaluate transition condition "output.passed ==="');
  });

  it('should handle complex expressions', () => {
    const next = service.evaluateTransition(
      [{ condition: 'x > 5 && y == "ok"', next: 'step_2' }],
      { x: 10, y: 'ok' },
    );
    expect(next).toBe('step_2');
  });
});
