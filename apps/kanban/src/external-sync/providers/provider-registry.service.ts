import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EXTERNAL_TICKET_PROVIDER } from "./external-ticket-provider.tokens.js";
import type { IExternalTicketProvider } from "./external-ticket-provider.types.js";

@Injectable()
export class ProviderRegistryService {
  private readonly providersByType = new Map<string, IExternalTicketProvider>();

  constructor(
    @Inject(EXTERNAL_TICKET_PROVIDER)
    providers: IExternalTicketProvider[],
  ) {
    for (const provider of providers) {
      if (this.providersByType.has(provider.providerType)) {
        throw new ConflictException(
          `Duplicate external ticket provider type: ${provider.providerType}`,
        );
      }
      this.providersByType.set(provider.providerType, provider);
    }
  }

  resolve(providerType: string): IExternalTicketProvider {
    const provider = this.providersByType.get(providerType);
    if (!provider) {
      throw new NotFoundException(
        `Unknown external ticket provider type: ${providerType}`,
      );
    }
    return provider;
  }
}
