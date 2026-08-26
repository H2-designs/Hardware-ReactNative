# MDB for React Native

Wrapper around the CM30 SDK — React Native support for the MDB Cashless Device stack.
Two things live here:

| Folder / file | What it is |
|---|---|
| `react-native-mdb/` | **The RN library** — a thin native bridge over `mdb-lib` + `mqtt-lib` (the proven Kotlin AARs are bundled inside). Full vend/payment flow, dashboard link, settings, hex configs — everything the native API has, as JS functions + events. |
| `MdbDemo/` | **The demo app** (reference integration) — status badge, live log, and a vend-approval sheet. `MdbDemo/App.tsx` is the file to read. |
| `MdbRnDemo-v1.0.0-release.apk` | **Prebuilt release APK** of the demo — standalone, no Metro needed. |
| `dashboard/log-viewer.html` | **The live MQTT dashboard** — open in any browser, pick the device, send remote commands. Same file the native app uses. |
| `docs/mdb-reactnative-manual.html` | **The full RN developer manual** — every function, event and config with examples. Start here. |
| `docs/mdb-library-manual.html` | The native (Kotlin) library manual — the layer under the bridge. |
| `docs/mdb-architecture.html` | Architecture doc — how MDB engine, MQTT and dashboard talk to each other. |
| `docs/mdb-vend-simulator.html` | Interactive vend-flow simulator — step through request/approve/success/fail paths. |

Android-only (the CM30 hardware library is Android/armeabi-v7a). The same dashboard
(`log-viewer.html`) works unchanged — the wire protocol is identical to the native app's.

## Installing the library in your own app

```sh
npm install <path-to>/react-native-mdb     # or publish it to your registry
```

Autolinking does the rest — no manual `settings.gradle` edits. Two requirements in
`android/build.gradle`:

- `minSdkVersion = 30` (the CM30 terminal runs Android 11; the AARs are built for it)
- nothing else — the three AARs (mdb-lib, mqtt-lib, CM30 vendor) ship inside the package.

## Quick start

```tsx
import Mdb from 'react-native-mdb';

const id = await Mdb.getSuggestedDeviceId();     // last-6-of-ANDROID_ID, dashboard-compatible
Mdb.initMqtt('cm30-mdb/hamdan-rabbah', id);      // OPTIONAL - skip it and MDB runs offline
Mdb.startMqtt();
Mdb.initMdb();
Mdb.startMdb();
```

## The payment flow

```tsx
Mdb.setCancelMode('vendDenied');                 // once ever - persisted

const subs = [
  Mdb.onVendRequest(async ({ amount, minorUnits, itemNumber }) => {
    // minorUnits = 350 (EXACT integer halalas - use for the gateway)
    // amount     = 3.5 (decimal - display only: amount.toFixed(2))
    const ok = await gateway.authorize(minorUnits);
    if (ok) await Mdb.approveVend();
    else    await Mdb.cancelVend();              // sends the standing cancel mode
  }),
  Mdb.onVendSuccess(({ itemNumber }) => gateway.capture()),   // product dispensed
  Mdb.onVendFailure(() => gateway.refund()),                  // jam - customer got nothing
  Mdb.onSessionEnded(() => clearTransactionState()),          // fires after EVERY session
];
// on unmount: subs.forEach(s => s.remove());
```

## Full API

Functions (all mirror the Kotlin API 1:1 — see the library manual for deep explanations):

```
initMqtt(prefix, deviceId) · startMqtt() · stopMqtt() · mqttEnqueue(line) · isMqttConnected()
initMdb() · startMdb() · stopMdb()
beginSession() · approveVend() · cancelVend() · cancelVendWith('sessionCancel'|'vendDenied')
getCurrentState() · isSessionActive()
setCancelMode(mode) · setAutoSession(bool) · isAutoSession() · setMdbLevel(1|2|3)
setMqttLogging(bool) · setPollVisibility(bool) · setUnhandledVisibility(bool) · getSettingsJson()
getConfigHex(name) · setConfigHex(name, hex) · resetConfig(name) · configNames() · configSnapshotJson()
priceToAmount(raw) · priceToMinorUnits(raw) · getSuggestedDeviceId()
```

Events (each returns a subscription; `.remove()` to unsubscribe):

```
onVendRequest({amount, minorUnits, itemNumber})   the payment hook
onVendSuccess({itemNumber})                       capture point
onVendFailure()                                   refund point
onSessionEnded()                                  cleanup point (fires on every outcome)
onLog({line, showOnScreen})                       engine log mirror - skip showOnScreen=false
onStatus({json})                                  VMC state, instant on change + 3s heartbeat
onRemoteCommand({command})                        dashboard commands MDB didn't recognize
```

Every dashboard MQTT command keeps working in parallel — both paths call the same Kotlin code.

## Building the demo

```sh
cd MdbDemo
npm install
cd android && ./gradlew assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk (standalone, no Metro needed)
```

For development with hot reload: `npm start` in one terminal, `npm run android` in another.

Note: the demo installs the library from the local folder next to it, so `MdbDemo/metro.config.js`
points Metro at it (`watchFolders` + `resolver.nodeModulesPaths`). A normal registry install of
`react-native-mdb` in your own app needs none of that.
