package com.rabbah.mdbrn

import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.rabbah.mdb.MdbLib
import com.rabbah.mdb.MdbConfigStore
import com.rabbah.mqtt.MqttConfig
import com.rabbah.mqtt.MqttLib

/**
 * The React Native bridge for mdb-lib + mqtt-lib. A THIN shim, exactly as a Turbo/native module
 * should be: every method is a one-line delegation into the Kotlin libraries, and every library
 * listener is forwarded to JS as a DeviceEventEmitter event. No protocol logic lives here.
 *
 * Events emitted to JS (all safe: emitted from the MDB worker thread, RN marshals to the JS
 * thread itself):
 *   MdbVendRequest  { amount: number, minorUnits: number, itemNumber: number }
 *   MdbVendSuccess  { itemNumber: number }
 *   MdbVendFailure  { }
 *   MdbSessionEnded { }
 *   MdbLog          { line: string, showOnScreen: boolean }
 *   MdbStatus       { json: string }   // {"state": "...", "recentActivity": bool}
 *   MdbRemoteCommand{ command: string } // dashboard commands mdb-lib did not consume
 */
class MdbRnModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "MdbRn"

    private fun emit(event: String, params: WritableMap?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, params)
    }

    // ------------------------------------ MQTT ------------------------------------

    @ReactMethod
    fun initMqtt(topicPrefix: String, deviceId: String) {
        MqttLib.init(MqttConfig(topicPrefix = topicPrefix, deviceId = deviceId))
    }

    @ReactMethod fun startMqtt() = MqttLib.start()
    @ReactMethod fun stopMqtt() = MqttLib.stop()

    /** The one way out for the app's own log lines - same queue MDB uses. */
    @ReactMethod fun mqttEnqueue(line: String) = MqttLib.enqueue(line)

    @ReactMethod fun isMqttConnected(promise: Promise) = promise.resolve(MqttLib.isConnected)

    // ------------------------------------ MDB lifecycle ------------------------------------

    @ReactMethod
    fun initMdb() {
        MdbLib.init(reactContext.applicationContext)

        MdbLib.vendListener = object : MdbLib.VendListener {
            override fun onVendRequest(amount: Double, minorUnits: Int, itemNumber: Int) {
                val map = Arguments.createMap()
                map.putDouble("amount", amount)
                map.putInt("minorUnits", minorUnits)
                map.putInt("itemNumber", itemNumber)
                emit("MdbVendRequest", map)
            }
            override fun onVendSuccess(itemNumber: Int) {
                val map = Arguments.createMap()
                map.putInt("itemNumber", itemNumber)
                emit("MdbVendSuccess", map)
            }
            override fun onVendFailure() = emit("MdbVendFailure", Arguments.createMap())
            override fun onSessionEnded() = emit("MdbSessionEnded", Arguments.createMap())
        }

        MdbLib.logListener = { line, showOnScreen ->
            val map = Arguments.createMap()
            map.putString("line", line)
            map.putBoolean("showOnScreen", showOnScreen)
            emit("MdbLog", map)
        }

        MdbLib.statusListener = { json ->
            val map = Arguments.createMap()
            map.putString("json", json)
            emit("MdbStatus", map)
        }

        // Registered AFTER MdbLib.init, so mdb-lib's own listener gets first look at every
        // command; whatever it declines is forwarded to JS (and consumed, so the dashboard
        // does not see "unknown command" for the app's own commands).
        MqttLib.addCommandListener { cmd ->
            val map = Arguments.createMap()
            map.putString("command", cmd)
            emit("MdbRemoteCommand", map)
            true
        }
    }

    @ReactMethod fun startMdb() = MdbLib.start()
    @ReactMethod fun stopMdb() = MdbLib.stop()

    // ------------------------------------ vend actions ------------------------------------

    @ReactMethod fun beginSession() = MdbLib.beginSession()
    @ReactMethod fun approveVend(promise: Promise) = promise.resolve(MdbLib.approveVend())
    @ReactMethod fun cancelVend(promise: Promise) = promise.resolve(MdbLib.cancelVend())

    /** [mode] is "sessionCancel" or "vendDenied" - a one-time override. */
    @ReactMethod
    fun cancelVendWith(mode: String, promise: Promise) {
        val response = if (mode == "vendDenied") MdbLib.CancelResponse.VEND_DENIED
                       else MdbLib.CancelResponse.SESSION_CANCEL_REQUEST
        promise.resolve(MdbLib.cancelVend(response))
    }

    // ------------------------------------ state ------------------------------------

    @ReactMethod fun getCurrentState(promise: Promise) = promise.resolve(MdbLib.currentState)
    @ReactMethod fun isSessionActive(promise: Promise) = promise.resolve(MdbLib.isSessionActive)

    // ------------------------------------ settings ------------------------------------

    /** [mode] is "sessionCancel" or "vendDenied". */
    @ReactMethod
    fun setCancelMode(mode: String) {
        MdbLib.setCancelMode(
            if (mode == "vendDenied") MdbLib.CancelResponse.VEND_DENIED
            else MdbLib.CancelResponse.SESSION_CANCEL_REQUEST
        )
    }

    @ReactMethod fun setAutoSession(enabled: Boolean) = MdbLib.setAutoSession(enabled)
    @ReactMethod fun isAutoSession(promise: Promise) = promise.resolve(MdbLib.isAutoSession)
    @ReactMethod fun setMdbLevel(level: Int) = MdbLib.setMdbLevel(level)
    @ReactMethod fun setMqttLogging(enabled: Boolean) = MdbLib.setMqttLogging(enabled)
    @ReactMethod fun setPollVisibility(show: Boolean) = MdbLib.setPollVisibility(show)
    @ReactMethod fun setUnhandledVisibility(show: Boolean) = MdbLib.setUnhandledVisibility(show)
    @ReactMethod fun getSettingsJson(promise: Promise) = promise.resolve(MdbLib.currentSettingsJson())

    // ------------------------------------ hex payload configs ------------------------------------

    @ReactMethod fun getConfigHex(name: String, promise: Promise) = promise.resolve(MdbLib.getConfigHex(name))

    /** Resolves null on success, or the human-readable validation error. */
    @ReactMethod fun setConfigHex(name: String, hex: String, promise: Promise) =
        promise.resolve(MdbLib.setConfigHex(name, hex))

    @ReactMethod fun resetConfig(name: String, promise: Promise) = promise.resolve(MdbLib.resetConfig(name))

    @ReactMethod
    fun configNames(promise: Promise) {
        val arr = Arguments.createArray()
        MdbConfigStore.names().forEach { arr.pushString(it) }
        promise.resolve(arr)
    }

    @ReactMethod fun configSnapshotJson(promise: Promise) = promise.resolve(MdbConfigStore.snapshotJson())

    // ------------------------------------ price helpers ------------------------------------

    @ReactMethod fun priceToAmount(raw: Int, promise: Promise) = promise.resolve(MdbLib.priceToAmount(raw))
    @ReactMethod fun priceToMinorUnits(raw: Int, promise: Promise) = promise.resolve(MdbLib.priceToMinorUnits(raw))

    // ------------------------------------ helpers ------------------------------------

    /** The same 6-char device id scheme the native demo app uses (last 6 of ANDROID_ID). */
    @ReactMethod
    fun getSuggestedDeviceId(promise: Promise) {
        val androidId = Settings.Secure.getString(
            reactContext.contentResolver, Settings.Secure.ANDROID_ID
        )
        promise.resolve((androidId ?: "unknown").takeLast(6).uppercase())
    }

    // Required stubs so NativeEventEmitter does not warn on newer RN versions.
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
