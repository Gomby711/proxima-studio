import type { ProximaApi } from '../electron/shared/ipc';

declare global {
  interface Window {
    api: ProximaApi;
  }
}

export {};
