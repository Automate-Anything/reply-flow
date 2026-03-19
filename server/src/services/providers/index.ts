import type { ChannelProvider } from '../channelProvider.js';
import { whatsappProvider } from './whatsapp.js';
import { emailProvider } from './email.js';

const providers: Record<string, ChannelProvider> = {
  whatsapp: whatsappProvider,
  email: emailProvider,
};

export function getProvider(channelType: string): ChannelProvider {
  const provider = providers[channelType];
  if (!provider) throw new Error(`No provider registered for channel type: ${channelType}`);
  return provider;
}

export function registerProvider(type: string, provider: ChannelProvider) {
  providers[type] = provider;
}
