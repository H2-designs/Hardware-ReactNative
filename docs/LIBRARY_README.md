# hardware-lib + mqtt-lib — integration guide

Two fully decoupled Android libraries extracted from the proven MDB Slave app:

| Artifact | What it is |
|---|---|
| `hardware-lib-7.9.3.aar` | **(renamed from mdb-lib)** The full MDB Cashless Device #1 slave (levels 1/2/3, config store, settings) for real CM30 hardware. **Contains NO networking of any kind** — everything it produces exits through listeners, everything it accepts enters through plain functions. Every exchange carries a stable integer **CMD code** (see the schema below). |
| `mqtt-lib-2.0.0.aar` | MQTT 3.1.1 transport (queue + publisher thread + auto-reconnect, broker **username/password** auth, retained presence/LWT, **connection-state listener**) **plus the Rabbah compact-log layer**: `RabbahLog`, the unified MDB/INFO codebooks, and `RabbahMqtt` (send/receive logs, text or JSON on any topic — zero MDB involvement). |
| `CM30-HardwareLibrary-1.0.9.aar` | The CM30 vendor serial driver (hardware-lib needs it at runtime; AARs do not nest). |

## Architecture — who talks to whom

```
VMC bus ── CM30 serial ── MdbSlaveWrapper ── HardwareLib (state machine, NO networking)
                                                │
                              listeners out     │     functions in
              ┌─────────────────────────────────┼──────────────────────────┐
              │ vendListener      (payments)    │  handleCommand(text)     │
              │ stateListener     (state name)  │  approveVend()/cancel…   │
              │ exchangeListener  (CMD events)  │  setReplyHex(code, hex)  │
              │ logListener       (lines)       │  setMdbLevel(...) etc.   │
              │ controlListener   (tag, json)   │                          │
              └─────────────────────────────────┴──────────────────────────┘
                                                │
                                     MdbMqttBridge (~30 lines, lives in the APP)
                                                │
                                            MqttLib ↔ broker ↔ dashboard
```

The bridge is the ONLY meeting point (full source: `app/src/main/java/.../MdbMqttBridge.kt`).
Its three wires keep the MQTT format **byte-identical** to before the split, so the existing
dashboard needs zero changes:

```kotlin
MqttLib.addCommandListener { HardwareLib.handleCommand(it) }           // commands in
HardwareLib.addControlListener { tag, payload ->                        // control plane out
    if (tag == "LOG") MqttLib.enqueue(payload) else MqttLib.enqueue("$tag:$payload")
}
HardwareLib.addExchangeListener { e ->                                  // exchanges out
    if (e.publishRemote) {
        RabbahLog.sessionId = e.sessionId
        RabbahLog.log(MdbLogEvent.valueOf(e.logEventName), e.params)
    }
}
```

Since 7.2.0 the bridge registers via `addControlListener`/`addExchangeListener`
(multi-listener), so the single-slot vars (`HardwareLib.exchangeListener` etc.) stay free for
your own code — see "Multiple consumers" below.

Want HTTP or BLE instead of MQTT? Write your own 30-line bridge against the same three hooks.
Want no network at all? Attach no bridge — the engine, vend flow, and all local listeners work
fully offline.

> Migration note: the Kotlin package is still `com.rabbah.mdb` and a deprecated
> `typealias MdbLib = HardwareLib` keeps old code compiling — the only hard change is the
> gradle dependency (`project(':hardware-lib')` / `hardware-lib-7.9.3.aar`) and that MQTT
> forwarding now needs the bridge attached.

## The CMD code schema

Every exchange the engine handles has ONE stable integer code (`MdbCmd`, append-only — codes
are never renumbered). `exchangeListener` delivers them live; the hex APIs address them by
number.

| Code | VMC sends | We reply | Reply hex editable? | RX captured |
|---|---|---|---|---|
| 111 | RESET (10) | ACK | fixed | yes |
| 112 | POLL (12) | JUST RESET | `JUST_RESET` | yes |
| 113 | SETUP CONFIG (11 00) | READER CONFIG DATA | `READER_CONFIG_DATA` | yes |
| 114 | EXPANSION REQUEST ID (17 00) | PERIPHERAL ID | `READER_CONFIG_INFO` / `_L3` | yes — the VMC's ID payload |
| 115 | SETUP MAX/MIN PRICES (11 01) | ACK | fixed | yes — the price limits |
| 116 | EXPANSION ENABLE OPTIONS (17 04) | ACK | fixed | yes — the feature bits |
| 117 | READER ENABLE (14 01) | ACK | fixed | yes |
| 118 | READER DISABLE (14 00) | ACK | fixed | yes |
| 119 | READER CANCEL (14 02) | CANCELLED | `CAN` | yes |
| 120 | POLL (12) | BEGIN SESSION | `SESSION_BEGIN` / `_L2` (1–35 bytes) | yes |
| 121 | VEND REQUEST (13 00) | ACK | fixed | yes — price + item |
| 122 | POLL (12) | VEND APPROVED | `VEND_APPROVED` | yes |
| 123 | POLL (12) | VEND DENIED | `VEND_DENIED` | yes |
| 124 | VEND SUCCESS (13 02) | ACK | fixed | yes |
| 125 | VEND FAILURE (13 03) | ACK | fixed | yes |
| 126 | VEND SESSION COMPLETE (13 04) | ACK | fixed | yes |
| 127 | POLL (12) | END SESSION | `END_SESSION` | yes |
| 128 | VEND CANCEL (13 01) | ACK | fixed | yes |
| 129 | POLL (12) | SESSION CANCEL REQUEST | `SESSION_CANCEL` | yes |
| 130 | REVALUE REQUEST (15 00) | REVALUE DENIED | `REVALUE_DENIED` | yes |
| 131 | REVALUE LIMIT REQUEST (15 01) | REVALUE LIMIT AMOUNT | `REVALUE_LIMIT` | yes |
| 132 | CASH SALE (13 05) | ACK | fixed | yes — price + item |
| 133 | POLL (12), idle | ACK | fixed | yes |
| 134 | EXPANSION, other subcommand | (varies) | — | yes |
| 135 | other peripheral (outside 10–17) | (ignored) | — | yes |
| 136 | unrecognized in current state | (none) | — | yes |
| 110 | anything unmatched (fallback) | — | — | yes |

Working with codes from Android:

```kotlin
HardwareLib.exchangeListener = { e ->
    when (e.code) {
        113 -> Log.i(TAG, "setup answered with ${HardwareLib.getReplyHex(113)}")
        114 -> Log.i(TAG, "VMC identified itself: ${e.rxHex}")
        121 -> Log.i(TAG, "vend request: ${e.message}")   // human sentence, ready to show
    }
}

HardwareLib.getReplyHex(114)                 // current PERIPHERAL ID payload (level-aware)
HardwareLib.setReplyHex(114, "09 01 ...")    // edit it by code — null = ok, else error text
HardwareLib.setReplyHex(113, "01 02 19 78 01 02 E8 0B")   // READER CONFIG DATA
HardwareLib.lastReceivedHex(114)             // the VMC's last EXPANSION REQUEST ID frame, saved
HardwareLib.lastReceivedJson()             // {"114": "17 00 ...", "115": "11 01 ...", ...}
HardwareLib.replyConfigName(120)            // "SESSION_BEGIN_L2" (at level 2/3)
MdbCmd.fromCode(114)                         // the schema entry itself (names, template)
```

Each `MdbExchangeEvent` carries: `cmd`/`code`, `rxHex`, `txName`, `params` (codebook-ready:
p[0]=rx, p[1]=tx, extras like price/item/level), `message` (the human sentence), `sessionId`
(non-null from BEGIN SESSION to END SESSION), `publishRemote` (the remote-logging gate),
`showOnScreen` (false for idle-poll noise), `timestampMs`.

## HardwareLib listeners

| Listener | Fires with | When |
|---|---|---|
| `stateListener` | `"INACTIVE_STATE" \| "DISABLED_STATE" \| "ENABLED_STATE" \| "VEND_STATE"` | On every state TRANSITION only (edge-triggered — never on heartbeats) |
| `exchangeListener` | `MdbExchangeEvent` | Once per handled bus exchange, CMD-coded |
| `logListener` | `(line, showOnScreen)` | Every human-readable line |
| `statusListener` | `{"state": ..., "recentActivity": ...}` JSON | **Event-driven, never polled**: every transition, every recentActivity flip (bus traffic appeared / went quiet past 5 s), and start/stop |
| `controlListener` | `(tag, payload)` — tags `LOG`, `SETTINGS_JSON`, `CONFIG_JSON`, `VMC_STATUS` | Whenever the engine reports/announces |
| `vendListener` | typed vend callbacks | See "Taking payments" below |

### logListener vs exchangeListener — same event, two formats

When the machine sends a frame and the library replies, BOTH listeners fire with the same
exchange — the difference is only the shape you receive it in:

```
VMC sends 11 00 ... → library replies READER CONFIG DATA
        │
        ├─ logListener gets ONE STRING (ready to show):
        │     "SETUP CONFIG rx=SETUP CONFIG tx=READER CONFIG DATA level=2"  (rx = command NAME since 7.6.1)
        │
        └─ exchangeListener gets AN OBJECT (ready to use):
              code = 113, rxHex = "11 00 03 10", txName = "READER CONFIG DATA", sessionId, ...
```

- **`logListener` = text, for display** — a TextView, Logcat, a log file. You can't easily ask
  "was this code 113?" without parsing the sentence.
- **`exchangeListener` = data, for logic** — `if (e.code == 113) ...`, analytics, forwarding,
  saving hex. Its `e.message` is the identical sentence logListener receives.
- One extra scope difference: `logListener` ALSO hears the engine's status lines
  (`[remote] vend approved requested`, `open() failed…`, config acks); `exchangeListener`
  fires strictly for bus exchanges.

Rule of thumb: show text to a person → `logListener`; make a decision in code →
`exchangeListener`; both jobs in one app → attach both (different slots, no conflict).

### Multiple consumers — add/remove listeners (7.2.0)

Each `HardwareLib.xListener = { ... }` var is a SINGLE slot: a second assignment silently
replaces the first. That bites the moment two parties want the same feed — most commonly your
own code plus `MdbMqttBridge` (which forwards exchanges to the dashboard). Since 7.2.0 the
bridge registers through the multi-listener API instead, so **the var slots are always free
for your code**, and any number of extra consumers can register:

```kotlin
val mine: (MdbExchangeEvent) -> Unit = { e -> if (e.code == 121) charge(e.params[2].toInt()) }
HardwareLib.addExchangeListener(mine)      // alongside the bridge, alongside the var slot
HardwareLib.removeExchangeListener(mine)   // true when it was registered

// same pattern for the other feeds:
HardwareLib.addLogListener { line, show -> ... }      / removeLogListener(...)
HardwareLib.addStateListener { state -> ... }         / removeStateListener(...)
HardwareLib.addControlListener { tag, json -> ... }   / removeControlListener(...)
```

All registered listeners AND the var slot receive every event; a listener that throws is
caught and skipped, never fatal to the others.

**If exchangeListener seems to receive nothing, check in this order:** (1) stale AAR — the
demo app prints `hardware-lib 7.4.0` in its boot banner (`HardwareLib.VERSION`); anything
older means your build still bundles the old library; (2) you are on < 7.2.0 and the bridge
overwrote your assignment — upgrade, or use `addExchangeListener`; (3) no real VMC is
connected — exchange events fire only for actual bus frames (the engine reports
`open() failed…` through logListener when the port is dead); (4) you assigned the listener
after expecting past events — there is no replay, only live exchanges from registration.

**The built-in self-test (7.3.0):** `HardwareLib.simulateExchange("10 10")` pushes a fake
RESET through the exact classify → template → listener pipeline — no machine, no open port
needed; listeners fire synchronously on the calling thread. The demo app runs it once at
boot, so the screen always shows `[exchange] code=111 RESET_ACK rx=10 10 tx=ACK` within a
second of launch — if you see that line, the exchange feed provably works on the device.
Dashboard equivalent: send the command `simulateExchange:10 10` (any hex works, e.g.
`simulateExchange:13 00 01 F4 00 03` produces a code-121 VEND REQUEST with price 500).

All listeners run on the engine's offload thread, never the bus thread — a slow listener can
never make a response miss the VMC's reply window, but return promptly anyway. Attach
listeners BEFORE `HardwareLib.init(context)` — init publishes the first settings snapshot.

**Every call answers true/false.** No public function returns nothing: lifecycle
(`init`/`start`/`stop`), session/vend (`beginSession`/`approveVend`/`cancelVend`), every
setting (`setAutoSession`, `setMdbLevel`, `setMqttLogging`, the visibility toggles,
`setCancelMode`) and every mqtt-lib call (`init`/`start`/`stop`, `enqueue`,
subscribe/unsubscribe, listener add/remove, `RabbahLog.log`/`raw`) returns `Boolean` —
true = done/queued, false = rejected or not applicable (e.g. `start()` with no MDB port,
`enqueue` before `MqttLib.init`, `setMdbLevel(9)`). Only value-returning calls differ:
`setConfigHex`/`setReplyHex` return `null` on success or the error sentence.

`HardwareLib.handleCommand(text): Boolean` is the transport-agnostic remote-control entry:
feed it whatever text arrives from MQTT/HTTP/BLE/adb; it consumes what it recognizes
(open/close/vendApprove/cancelVend/setMdbLevel:…/setConfig JSON/…) and returns false
otherwise.

## Integration — the whole thing

```kotlin
// once, at startup (Application or first Activity):
MqttLib.init(MqttConfig(topicPrefix = "cm30-mdb/hamdan-rabbah", deviceId = myDeviceId,
                        brokerHost = "YOUR-SERVER", username = "rabbah", password = "…"))
MqttLib.start()
MdbMqttBridge.attach()                 // the glue (copy MdbMqttBridge.kt from app/)
HardwareLib.init(applicationContext)
HardwareLib.start()
// Done. All MDB data flows to the dashboard; all remote commands work.
```

## Pulse output — PulseLib (7.5.0)

Pulse driving over the CM30's digital IO (`android.hardware.digital.DigitalIO`), with the
timing guarantees the machine demands — a stretched pulse width is a rejected pulse:

```kotlin
// Polarity, from the backend/dashboard boolean:
PulseLib.initPulse(true)    // HIGH-pulse mode: pin idles LOW now, pulses go HIGH
PulseLib.initPulse(false)   // LOW-pulse mode:  pin idles HIGH now, pulses go LOW

// Send a train and get the REAL result (true = every pulse physically sent):
val ok = PulseLib.sendPulse(pulseWidthMs = 50, pulsePeriodMs = 100, count = 3)
```

- **Engine-owned timing (7.9.3).** The engine drives every edge itself via
  `digital_out_set_value` on a dedicated `PulseWorker` thread (URGENT_AUDIO): active level for
  width ms, idle for (period - width) ms, exactly count times, deadline-based sleep-then-spin
  waits. The vendor's `digital_out_pulse` is NOT used for trains - on real hardware it sent
  the wrong count and ignored the direction (undocumented parameters); `vendorPulse` keeps it
  reachable for experiments only.
- **Ready feedback (7.9.0).** `setReadyFeedback(expectedValue, channel = 0)` arms a gate
  from the backend model: before every train, `digital_in_get_value(channel)` must equal the
  expected value or the pulse is refused (`[pulse] sendPulse rejected - machine not ready`).
  Pass `null` (machine does not support ready feedback) and pulses are always allowed.
  `isMachineReady()` runs the same check on demand and logs expected/actual/ready. Dashboard:
  `setReadyFeedback:0` / `setReadyFeedback:0,1` / `setReadyFeedback:off`, `checkMachineReady`.
- **`sendPulse` blocks until the train finishes** (~ period × count) and returns true only if
  every pulse went out — call it from a coroutine/background thread, never the UI thread. The
  worker's priority does the timing; your thread just waits for the answer.
- **`initPulse` drives the idle level immediately** and can be called again whenever the
  backend changes the setting. `sendPulse` refuses to run before `initPulse` (wrong idle
  level = wrong pulses). Read state via `PulseLib.isInitialized` / `isHighPulse` /
  `pendingTrains`.
- **Dashboard/backend commands** (via `handleCommand`, so they work over MQTT with no extra
  wiring): `initPulse:true`, `initPulse:false`, `sendPulse:50,100,3` (width,period,count —
  remote trains run detached so the MQTT reader never stalls). Results arrive as
  `[pulse] sent 3 pulse(s) width=50ms period=100ms mode=HIGH` log lines.
- **`PulseLib.vendorPulse(p1,p2,p3,p4)`** is a raw passthrough to the vendor's own native
  `digital_out_pulse` for experiments — the vendor shipped no parameter names (known
  constants: `PULSE_DIR_POSITIVE=0`, `PULSE_DIR_NEGATIVE=1`).
- No CM30 runtime (emulator) → reported `[pulse] ... failed` lines and `false`, never a crash.

## RabbahLog — sending logs (the compact codebook envelope)

```kotlin
RabbahLog.init("vending-app", "2.13.9")          // once — names the emitter on every item

RabbahLog.raw("payment gateway responded in 420ms")          // free text
RabbahLog.rawError("gateway timeout after 3 retries")        // free text, severity=e
RabbahLog.log(MdbLogEvent.MDB_VEND_REQUEST,                  // typed event
              "13 00 01 F4 00 03", "ACK", "500", "3")
```

On the wire each call is one compact item on the `liveLog` topic — identical envelope to the
production Rabbah Log Codebook (`t/s/m/a/v/k/i/d/p`, single-letter keys, positional params):

```
RABBAH_LOG:{"t":"1787743651002","s":"MDB","m":"13","a":"vending-app","v":"2.13.9",
            "k":"i","i":"7c1f2a9b","d":1,"p":["13 00 01 F4 00 03","ACK","500","3"]}
```

The dashboard decodes codes back into sentences using the codebook the device itself serves
(`getCodebook` → `CODEBOOK_JSON:{…}`), so decode tables can never drift from the emitting
build. `RabbahLog.makeLogJson(...)` builds the envelope without sending;
`RabbahLog.format(event, params)` renders the sentence locally.

## RabbahMqtt — the generic MQTT API (no MDB required)

The one-stop surface for an Android app that just wants to talk to the broker. Everything is
queued (never blocks, buffers offline, silent no-op when MQTT is off), and every subscription
re-establishes itself on reconnect.

```kotlin
// logs — ride the RABBAH_LOG envelope, render on the dashboard automatically:
RabbahMqtt.sendLog("payment gateway responded in 420ms")
RabbahMqtt.sendError("gateway timeout after 3 retries")

// generic inbox — plain-text messages on the commands topic:
val cmdSub = RabbahMqtt.onCommand { cmd ->
    when (cmd) {
        "rebootKiosk" -> { scheduleReboot(); true }   // true = consumed, chain stops
        else -> false                                 // false = let other listeners look
    }
}
RabbahMqtt.removeCommand(cmdSub)

// any custom channel "<prefix>/<deviceId>/<suffix>", both directions, both formats:
RabbahMqtt.sendJson("telemetry", JSONObject().put("battery", 87))
RabbahMqtt.sendText("status", "READY")
val s1 = RabbahMqtt.subscribeJson("inbox")   { json -> ... }   // non-JSON arrives as {"raw": "..."}
val s2 = RabbahMqtt.subscribeText("control") { text -> ... }
RabbahMqtt.unsubscribe(s1)
```

Handlers run on the MQTT reader thread — return quickly, never block, hop to your own thread
for real work. Topics are always `<prefix>/<deviceId>/<suffix>`; callers never build one.

## MQTT connection status — event-driven, no polling

Any Android code can SEE whether the broker session is up, the moment it changes:

```kotlin
// The listener: called once immediately with the CURRENT state (your status view is right
// from the first frame), then exactly once per change - connected=true the moment the
// session is fully up (CONNACK + subscriptions), false the moment it drops.
val sub = RabbahMqtt.onConnection { connected ->
    runOnUiThread { statusView.text = if (connected) "MQTT: CONNECTED" else "MQTT: OFFLINE" }
}
RabbahMqtt.removeConnection(sub)          // stop receiving

// The same thing at transport level (what the demo app uses for its log line):
MqttLib.addConnectionListener { connected -> ... }

// On-demand check, no listener:
RabbahMqtt.isConnected                     // true while the session is up right now
```

Reconnecting stays automatic either way — this is purely visibility. Sends still work while
offline (they queue and drain on reconnect). The demo app shows it as a log line:
`[mqtt] CONNECTED to uat-api.rabbah.sa` / `[mqtt] DISCONNECTED - reconnecting...`.

## Broker auth (private mosquitto etc.)

```kotlin
MqttLib.init(MqttConfig(
    topicPrefix = "cm30-mdb/hamdan-rabbah", deviceId = myDeviceId,
    brokerHost = "YOUR-SERVER-IP", brokerPort = 1883,
    username = "rabbah", password = "…"
))
```

The `log-viewer.html` dashboard can point at the same broker via its **WebSocket** listener
(mosquitto needs `listener 9001` + `protocol websockets`): open it once as
`log-viewer.html?broker=ws://YOUR-SERVER:9001&user=rabbah&pass=…` — values persist in
localStorage (query wins over stored). A browser cannot speak plain TCP 1883.

`rabbahlog-sample-v1.4.apk` (in `dist/`) is the proof app: editable broker settings on screen,
buttons for raw log / MDB example / telemetry JSON / burst, a live `queued/sent/dropped`
status line, and an `inbox` subscription you can hit with `mosquitto_pub`.

## Gradle setup

Preferred: consume the modules directly (`implementation project(':hardware-lib')`,
`project(':mqtt-lib')`) — see the demo `app/`.

If consuming raw AARs instead: add `hardware-lib-7.9.3.aar`, `mqtt-lib-2.0.0.aar`, **and**
`CM30-HardwareLibrary-1.0.9.aar` (hardware-lib needs it at runtime; AARs do not nest). If you
skip MQTT entirely, `hardware-lib` + the CM30 AAR alone are enough.

### Taking payments — the VendListener

This is the payment-gateway hook. `onVendRequest` fires when the customer selects an item;
run the gateway call on your own thread and answer with `approveVend()` / `cancelVend(...)` —
the library keeps the VMC waiting correctly in the meantime (per-spec delayed response):

```kotlin
HardwareLib.vendListener = object : HardwareLib.VendListener {
    override fun onVendRequest(amount: Double, minorUnits: Int, itemNumber: Int) {
        // minorUnits = 350 (EXACT integer halalas - use for the gateway & money math)
        // amount     = 3.5 (decimal, for display; format with "%.2f" to show 3.50)
        // The library already applied the scale factor. Pay async:
        scope.launch {
            val approved = paymentGateway.charge(minorUnits)       // your gateway call
            if (approved) HardwareLib.approveVend()
            else HardwareLib.cancelVend()   // uses the standing mode set via setCancelMode(...)
        }
    }
    override fun onVendSuccess(itemNumber: Int) { scope.launch { paymentGateway.capture() } }
    override fun onVendFailure()                { scope.launch { paymentGateway.refund() } }
    override fun onSessionEnded()               { /* per-session cleanup */ }
}
```

Callbacks fire on a dedicated callback thread, never the bus thread. Exceptions you throw are
caught and logged, never fatal. The price comes pre-scaled in two forms: `minorUnits: Int`
(exact integer halalas/cents — use for the gateway and all money math) and `amount: Double`
(decimal, for display — format with `%.2f`, never accumulate totals with it). `itemNumber`
stays the raw 16-bit item code; all are `-1`/`-1.0` if the VMC omitted those bytes.

### MDB control API

Every control exists in BOTH forms — a public function for a standalone app, and the
equivalent dashboard MQTT command (which arrives through the bridge as
`handleCommand(...)`). Both call the same code, settings persist either way, and every change
is reported back in `SETTINGS_JSON:` so a watching dashboard always shows the real values.

| App function | Dashboard command | What it does |
|---|---|---|
| `HardwareLib.start()` / `stop()` | `open` / `close` | Open/close the MDB port + worker loop |
| `HardwareLib.beginSession()` | `beginSession` | Start a session (the "card tap"; needed in manual mode) |
| `HardwareLib.approveVend(): Boolean` | `vendApprove` | Approve the pending VEND REQUEST (false if none pending) |
| `HardwareLib.setCancelMode(CancelResponse)` | `setCancelMode:sessionCancel` / `setCancelMode:vendDenied` | Set ONCE: the standing response for cancels + the VMC's own VEND CANCEL. Persisted. |
| `HardwareLib.cancelVend(): Boolean` | `cancelVend` | The simple cancel — sends the standing response set above |
| `HardwareLib.cancelVend(CancelResponse): Boolean` | `cancelVend:sessionCancel` / `cancelVend:vendDenied` | One-time override without touching the standing mode |
| `HardwareLib.setAutoSession(Boolean)` / `isAutoSession` | `setSessionMode:auto` / `setSessionMode:manual` | true = sessions begin by themselves, false = manual |
| `HardwareLib.setMdbLevel(1..3)` | `setMdbLevel:1\|2\|3` | MDB feature level (handshake + payloads) |
| `HardwareLib.setMqttLogging(Boolean)` / `isMqttLoggingEnabled` | `setMqttLogging:on\|off` | Gate the remote log stream (`publishRemote` on events + the "LOG" control tag) — local listeners and the control plane keep working while muted |
| `HardwareLib.setPollVisibility(Boolean)` | `setPollVisibility:on\|off` | Log-debug: show idle POLL/ACK |
| `HardwareLib.setUnhandledVisibility(Boolean)` | `setUnhandledVisibility:on\|off` | Log-debug: show commands addressed to us we could not answer |
| `HardwareLib.setEmptySessionVisibility(Boolean)` | `setEmptySessionVisibility:on|off` | Log empty (no-vend) session cycles. OFF by default: auto-session mode churns BEGIN/COMPLETE/END every re-arm with no customer - while off those cycles log NOTHING, and a session that gets a VEND REQUEST logs its full chain (BEGIN included, delivered at vend time). |
| `HardwareLib.setPeripheralVisibility(Boolean)` | `setPeripheralVisibility:on\|off` | Log-debug: show bus traffic addressed to OTHER peripherals (coin changer, bill validator). Separate from unhandled. The dashboard also has a client-side "Cashless only" filter. |
| `HardwareLib.handleCommand(text): Boolean` | — | Feed ANY transport's received text in; consumes what it recognizes |
| `HardwareLib.vendListener / logListener / statusListener / stateListener / exchangeListener / controlListener` | — | The full listener surface (see table above) |
| `HardwareLib.currentState: String` / `isSessionActive` / `sessionId` | — | Read state on demand: INACTIVE_STATE, DISABLED_STATE, ENABLED_STATE, VEND_STATE |
| `HardwareLib.getReplyHex(code)` / `setReplyHex(code, hex)` / `lastReceivedHex(code)` / `lastReceivedJson()` / `replyConfigName(code)` | — | CMD-code hex access (see schema above) |
| `HardwareLib.priceToAmount(raw)` / `priceToMinorUnits(raw)` | — | Standalone price converters using the live READER_CONFIG_DATA scale/decimals |

### Configuring the hex payloads from Android code

The same edits the dashboard's Config panel makes are available as functions — by name, or by
CMD code via `setReplyHex(code, hex)`. Byte length is locked per payload (only values change)
— EXCEPT the two Begin Session payloads, whose length is freely editable (1–35 bytes; some
feature-level-2 machines only accept the short Level-1-style 3-byte form). Changes persist
and are used on the very next send, no restart; an ack + fresh `CONFIG_JSON:` snapshot are
published automatically so any watching dashboard stays in sync.

```kotlin
HardwareLib.configNames()                                        // all editable names
HardwareLib.getConfigHex(HardwareLib.ConfigName.SESSION_BEGIN)   // -> "03 FF FF"
HardwareLib.setConfigHex(HardwareLib.ConfigName.SESSION_BEGIN_L2, "03 FF FF")  // null = ok
HardwareLib.resetConfig(HardwareLib.ConfigName.SESSION_BEGIN)    // back to library default
HardwareLib.configSnapshotJson()                                 // everything, as JSON
```

| `HardwareLib.ConfigName.…` | Bytes | What it is |
|---|---|---|
| `READER_CONFIG_DATA` | 8 | SETUP response: level, currency, scale, decimals, timeout, options (level byte overwritten at runtime) |
| `READER_CONFIG_INFO` | 30 | Peripheral ID (Level 2): manufacturer 3 + serial 12 + model 12 + sw version 2 |
| `READER_CONFIG_INFO_L3` | 34 | Peripheral ID (Level 3): same + 4 optional-feature-bits bytes — bit 5 of the LAST byte = Always Idle |
| `SESSION_BEGIN` | 1–35 (editable) | Begin Session (Level 1), default `03 FF FF` |
| `SESSION_BEGIN_L2` | 1–35 (editable) | Begin Session (Level 2/3), default 10 bytes — set `03 FF FF` for machines that want the short form |
| `REVALUE_LIMIT` | 3 | Revalue Limit Amount: code + limit hi/lo — sent as-is on REVALUE LIMIT REQUEST (15 01) |
| `REVALUE_DENIED` | 1 | Reply to a REVALUE REQUEST (15 00) — default `0E`; this device never credits funds onto media |
| `VEND_APPROVED` | 3 | code + price hi/lo (price overwritten at runtime) |
| `JUST_RESET` / `CAN` / `VEND_DENIED` / `END_SESSION` / `SESSION_CANCEL` | 1 | single response codes |

### Configs over MQTT (through the bridge)

Everything about response payloads — parsing, validation, persistence, live hot-reload,
acks — is `MdbConfigStore`'s job. Over MQTT, send JSON on the commands topic:

```json
{ "setConfig": { "SESSION_BEGIN": "03 FF FF", "READER_CONFIG_DATA": "01 02 19 78 01 02 E8 0B" } }
{ "resetConfig": ["SESSION_BEGIN"] }
{ "getConfig": true }
```

Per-name validation, per-name ack lines, and a full `CONFIG_JSON:` snapshot come back
automatically. The legacy text form (`setConfig:NAME:hex`, `resetConfig:NAME`, `getConfig`)
still works, so the existing `log-viewer.html` dashboard needs no changes. Locally:
`MdbConfigStore.applyJson(json)`, `.get(name)`, `.set(name, hex)`, `.snapshotJson()`.

Special byte worth knowing: **Always Idle** (Level 3) is bit 5 of the LAST byte (Z34) of
`READER_CONFIG_INFO_L3` — set that byte to `20` to enable. There is deliberately no separate
flag; the engine reads the declared wire bytes.

## Wire protocol (device <-> dashboard)

Unchanged by the split — the bridge reproduces it byte-identically:

- Topics: `<prefix>/<deviceId>/liveLog` (out) and `<prefix>/<deviceId>/commands` (in);
  suffixes configurable (`logTopicSuffix`/`commandTopicSuffix`/`statusTopicSuffix` for the
  `devices/{deviceCode}/logs|cmd|status` backend contract).
- Tagged messages out: `RABBAH_LOG:{…}` (compact log items), `CODEBOOK_JSON:{…}` (reply to
  `getCodebook`), `VMC_STATUS:{...}` (event-driven: instant on state change, on
  recentActivity flips, and on start/stop — no periodic heartbeat),
  `SETTINGS_JSON:{...}`, `CONFIG_JSON:{...}`, `PONG`; anything untagged is a plain log line.
- Queue: bounded (default 1000), drop-oldest on overflow (`MqttLib.droppedMessages` counts).
- The stack runs on the Rabbah mosquitto (mqtt://mosquitto:1883) with username/password auth;
  the app reads broker credentials from local.properties via BuildConfig.
