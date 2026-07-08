export const pluginEventDeliveryStatuses = [
  'pending',
  'delivering',
  'delivered',
  'failed',
  'dead_lettered',
] as const;

export type PluginEventDeliveryStatus =
  (typeof pluginEventDeliveryStatuses)[number];

export const pluginEventDeliveryModes = ['blocking', 'non_blocking'] as const;

export type PluginEventDeliveryMode = (typeof pluginEventDeliveryModes)[number];
