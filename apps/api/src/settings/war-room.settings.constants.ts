/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the war-room knobs
 * (work item 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 3).
 *
 * String-literal keys are used here so the fragment can be imported by
 * `system-settings.defaults.ts` without dragging in the war-room
 * consensus / signoff code path. The consensus engine re-reads the
 * signoff list, threshold, tie-break flag, and message cap on every
 * new signoff attempt so operator changes take effect on the next
 * round without restarting the API.
 *
 * Extracted out of `system-settings.defaults.ts` so that file stays
 * under the project's `max-lines` lint cap while the operator-tunable
 * knob surface continues to grow across milestones. The spread keeps
 * the seeded defaults byte-identical to the pre-refactor registry.
 */
export const WAR_ROOM_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  agent_war_room_required_signoff_roles: {
    value: ['architect', 'dev', 'qa'],
    description:
      'Ordered role list required for consensus signoff in war-room sessions',
  },
  agent_war_room_deadlock_signoff_threshold: {
    value: 3,
    description:
      'Minimum number of submitted required-role signoffs before a conflicting state is treated as deadlock',
  },
  agent_war_room_auto_ceo_tie_break: {
    value: false,
    description:
      'When true, deadlocked war-room sessions automatically apply CEO tie-break without manual approval',
  },
  agent_war_room_max_message_chars: {
    value: 4000,
    description:
      'Maximum allowed message length for war-room discussion messages',
  },
};
