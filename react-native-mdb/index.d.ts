import type { EmitterSubscription } from 'react-native';

export type CancelMode = 'sessionCancel' | 'vendDenied';
export type MdbState =
  | 'INACTIVE_STATE'
  | 'DISABLED_STATE'
  | 'ENABLED_STATE'
  | 'VEND_STATE';

export interface VendRequestEvent {
  /** Decimal price for display (3.5 for SAR 3.50). Floating point - do not do money math with it. */
  amount: number;
  /** EXACT integer minor units (350 halalas) - use this for the payment gateway. */
  minorUnits: number;
  /** Raw 16-bit item code, -1 if the VMC omitted it. */
  itemNumber: number;
}

export const ConfigName: {
  JUST_RESET: string;
  CAN: string;
  READER_CONFIG_DATA: string;
  READER_CONFIG_INFO: string;
  READER_CONFIG_INFO_L3: string;
  VEND_APPROVED: string;
  VEND_DENIED: string;
  END_SESSION: string;
  SESSION_CANCEL: string;
  SESSION_BEGIN: string;
  SESSION_BEGIN_L2: string;
  REVALUE_LIMIT: string;
  REVALUE_DENIED: string;
};

declare const Mdb: {
  initMqtt(topicPrefix: string, deviceId: string): void;
  startMqtt(): Promise<boolean>;
  stopMqtt(): Promise<boolean>;
  mqttEnqueue(line: string): Promise<boolean>;
  isMqttConnected(): Promise<boolean>;

  initMdb(): void;
  startMdb(): Promise<boolean>;
  stopMdb(): Promise<boolean>;

  beginSession(): Promise<boolean>;
  approveVend(): Promise<boolean>;
  cancelVend(): Promise<boolean>;
  cancelVendWith(mode: CancelMode): Promise<boolean>;

  getCurrentState(): Promise<MdbState>;
  isSessionActive(): Promise<boolean>;

  setCancelMode(mode: CancelMode): void;
  setAutoSession(enabled: boolean): Promise<boolean>;
  isAutoSession(): Promise<boolean>;
  setMdbLevel(level: 1 | 2 | 3): Promise<boolean>;
  setMqttLogging(enabled: boolean): Promise<boolean>;
  setPollVisibility(show: boolean): Promise<boolean>;
  setUnhandledVisibility(show: boolean): Promise<boolean>;
  getSettingsJson(): Promise<string>;

  getConfigHex(name: string): Promise<string>;
  setConfigHex(name: string, hex: string): Promise<string | null>;
  resetConfig(name: string): Promise<boolean>;
  configNames(): Promise<string[]>;
  configSnapshotJson(): Promise<string>;

  priceToAmount(raw: number): Promise<number>;
  priceToMinorUnits(raw: number): Promise<number>;

  getSuggestedDeviceId(): Promise<string>;

  onVendRequest(fn: (e: VendRequestEvent) => void): EmitterSubscription;
  onVendSuccess(fn: (e: { itemNumber: number }) => void): EmitterSubscription;
  onVendFailure(fn: () => void): EmitterSubscription;
  onSessionEnded(fn: () => void): EmitterSubscription;
  onLog(fn: (e: { line: string; showOnScreen: boolean }) => void): EmitterSubscription;
  onStatus(fn: (e: { json: string }) => void): EmitterSubscription;
  onRemoteCommand(fn: (e: { command: string }) => void): EmitterSubscription;
};

export default Mdb;
