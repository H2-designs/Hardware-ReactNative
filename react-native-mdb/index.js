/**
 * react-native-mdb - JS API over the CM30 MDB Cashless Device libraries.
 *
 * Quick start:
 *
 *   import Mdb from 'react-native-mdb';
 *
 *   const deviceId = await Mdb.getSuggestedDeviceId();
 *   Mdb.initMqtt('cm30-mdb/hamdan-rabbah', deviceId);   // optional - MDB works offline too
 *   Mdb.startMqtt();
 *   Mdb.initMdb();
 *   Mdb.startMdb();
 *
 *   const sub = Mdb.onVendRequest(({ amount, minorUnits, itemNumber }) => {
 *     // minorUnits = 350 (exact integer halalas, use for the gateway)
 *     // amount     = 3.5 (decimal, for display)
 *     gateway.authorize(minorUnits).then(ok =>
 *       ok ? Mdb.approveVend() : Mdb.cancelVend());
 *   });
 *   // later: sub.remove();
 */
import { NativeModules, NativeEventEmitter } from 'react-native';

const { MdbRn } = NativeModules;
if (!MdbRn) {
  throw new Error(
    'react-native-mdb: native module not found. Rebuild the Android app after installing ' +
    '(autolinking picks it up), and note this library is Android-only (CM30 hardware).'
  );
}

const emitter = new NativeEventEmitter(MdbRn);

/** Payload names for get/setConfigHex/resetConfig - never typo a raw string. */
export const ConfigName = {
  JUST_RESET: 'JUST_RESET',
  CAN: 'CAN',
  READER_CONFIG_DATA: 'READER_CONFIG_DATA',
  READER_CONFIG_INFO: 'READER_CONFIG_INFO',
  READER_CONFIG_INFO_L3: 'READER_CONFIG_INFO_L3',
  VEND_APPROVED: 'VEND_APPROVED',
  VEND_DENIED: 'VEND_DENIED',
  END_SESSION: 'END_SESSION',
  SESSION_CANCEL: 'SESSION_CANCEL',
  SESSION_BEGIN: 'SESSION_BEGIN',
  SESSION_BEGIN_L2: 'SESSION_BEGIN_L2',
  REVALUE_LIMIT: 'REVALUE_LIMIT',
  REVALUE_DENIED: 'REVALUE_DENIED',
};

const Mdb = {
  // ---- MQTT (optional: skip entirely and MDB runs offline) ----
  /** options (all optional): { host, port, username, password } - e.g.
   * Mdb.initMqtt('cm30-mdb/hamdan-rabbah', id, { host: 'uat-api.rabbah.sa', username: 'rabbah', password: '...' }) */
  initMqtt: (topicPrefix, deviceId, options) =>
    options
      ? MdbRn.initMqttEx(topicPrefix, deviceId,
          options.host ?? 'mosquitto', options.port ?? 1883,
          options.username ?? '', options.password ?? '')
      : MdbRn.initMqtt(topicPrefix, deviceId),
  startMqtt: () => MdbRn.startMqtt(),
  stopMqtt: () => MdbRn.stopMqtt(),
  /** Push your own log line onto the shared outbound queue (no-op without initMqtt). */
  mqttEnqueue: (line) => MdbRn.mqttEnqueue(line),
  isMqttConnected: () => MdbRn.isMqttConnected(),

  // ---- MDB lifecycle ----
  initMdb: () => MdbRn.initMdb(),
  startMdb: () => MdbRn.startMdb(),
  stopMdb: () => MdbRn.stopMdb(),

  // ---- vend actions ----
  beginSession: () => MdbRn.beginSession(),
  /** Resolves false if no VEND REQUEST is pending. */
  approveVend: () => MdbRn.approveVend(),
  /** Simple cancel: sends the standing mode set once via setCancelMode. */
  cancelVend: () => MdbRn.cancelVend(),
  /** One-time override: mode is 'sessionCancel' | 'vendDenied'. */
  cancelVendWith: (mode) => MdbRn.cancelVendWith(mode),

  // ---- state ----
  /** 'INACTIVE_STATE' | 'DISABLED_STATE' | 'ENABLED_STATE' | 'VEND_STATE' */
  getCurrentState: () => MdbRn.getCurrentState(),
  isSessionActive: () => MdbRn.isSessionActive(),

  // ---- settings (persisted; every change also syncs the dashboard) ----
  /** mode: 'sessionCancel' | 'vendDenied' - set ONCE, then cancelVend() is enough. */
  setCancelMode: (mode) => MdbRn.setCancelMode(mode),
  setAutoSession: (enabled) => MdbRn.setAutoSession(enabled),
  isAutoSession: () => MdbRn.isAutoSession(),
  setMdbLevel: (level) => MdbRn.setMdbLevel(level),
  setMqttLogging: (enabled) => MdbRn.setMqttLogging(enabled),
  setPollVisibility: (show) => MdbRn.setPollVisibility(show),
  setUnhandledVisibility: (show) => MdbRn.setUnhandledVisibility(show),
  getSettingsJson: () => MdbRn.getSettingsJson(),

  // ---- hex payload configs (dashboard auto-synced on every change) ----
  getConfigHex: (name) => MdbRn.getConfigHex(name),
  /** Resolves null on success, else the validation error text. */
  setConfigHex: (name, hex) => MdbRn.setConfigHex(name, hex),
  resetConfig: (name) => MdbRn.resetConfig(name),
  configNames: () => MdbRn.configNames(),
  configSnapshotJson: () => MdbRn.configSnapshotJson(),

  // ---- price helpers (onVendRequest already delivers both forms) ----
  priceToAmount: (raw) => MdbRn.priceToAmount(raw),
  priceToMinorUnits: (raw) => MdbRn.priceToMinorUnits(raw),

  // ---- pulse output ----
  /** Polarity from the backend boolean: true = HIGH-pulse mode (idle driven LOW immediately),
   * false = LOW-pulse mode (idle driven HIGH). Resolves true when the hardware accepted. */
  initPulse: (highPulse) => MdbRn.initPulse(highPulse),
  /** Sends one train (vendor-native timing, direction from initPulse) and resolves the REAL
   * result: true only when every pulse physically went out. Resolves after ~period x count ms. */
  sendPulse: (pulseWidthMs, pulsePeriodMs, count) => MdbRn.sendPulse(pulseWidthMs, pulsePeriodMs, count),
  /** Raw vendor digital_out_pulse(p1,p2,p3,p4) passthrough - experiments only. */
  vendorPulse: (p1, p2, p3, p4) => MdbRn.vendorPulse(p1, p2, p3, p4),
  /** Ready-feedback gate: pulses refused unless digital_in(channel) == expectedValue.
   * Two call shapes:
   *   setReadyFeedback(model.supportReadyFeedback, model.readyFeedbackValue)  // dashboard flag
   *   setReadyFeedback(0)            // value only (gate armed), null/undefined = disabled
   * supported=false or a null value disables the gate (pulses always allowed). */
  setReadyFeedback: (a, b, channel = 0) => {
    if (typeof a === 'boolean') return MdbRn.setReadyFeedback(a && b != null ? b : -1, channel);
    return MdbRn.setReadyFeedback(a ?? -1, b ?? 0);
  },
  /** true = machine ready to accept pulses (runs the digital-in check now). */
  isMachineReady: () => MdbRn.isMachineReady(),
  /** { initialized, highPulse, pendingTrains } */
  getPulseState: () => MdbRn.getPulseState(),

  // ---- helpers ----
  /** Last 6 chars of ANDROID_ID, uppercased - the same scheme the dashboard's device list uses. */
  getSuggestedDeviceId: () => MdbRn.getSuggestedDeviceId(),

  // ---- events (each returns a subscription; call .remove() to unsubscribe) ----
  /** { amount, minorUnits, itemNumber } - customer picked an item; answer with approveVend/cancelVend. */
  onVendRequest: (fn) => emitter.addListener('MdbVendRequest', fn),
  /** { itemNumber } - product physically dispensed: capture the payment. */
  onVendSuccess: (fn) => emitter.addListener('MdbVendSuccess', fn),
  /** Product did NOT dispense: refund/void. */
  onVendFailure: (fn) => emitter.addListener('MdbVendFailure', fn),
  /** Session fully closed (every outcome) - per-transaction cleanup point. */
  onSessionEnded: (fn) => emitter.addListener('MdbSessionEnded', fn),
  /** { line, showOnScreen } - every engine log line; skip rendering showOnScreen=false lines. */
  onLog: (fn) => emitter.addListener('MdbLog', fn),
  /** { json } - VMC status; fires instantly on every state change + 3s heartbeat. */
  onStatus: (fn) => emitter.addListener('MdbStatus', fn),
  /** { command } - dashboard commands mdb-lib did not recognize (your app's own commands). */
  onRemoteCommand: (fn) => emitter.addListener('MdbRemoteCommand', fn),
};

export default Mdb;
