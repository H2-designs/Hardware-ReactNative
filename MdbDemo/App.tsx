/**
 * MDB React Native demo - the reference integration of react-native-mdb.
 * Mirrors the native demo app: status badge, live log, vend approval flow.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Mdb, { VendRequestEvent } from 'react-native-mdb';

const TOPIC_PREFIX = 'cm30-mdb/hamdan-rabbah';
const MAX_LOG_LINES = 300;

type LogRow = { id: number; line: string };

export default function App(): React.JSX.Element {
  const [deviceId, setDeviceId] = useState('......');
  const [mdbState, setMdbState] = useState('INACTIVE_STATE');
  const [running, setRunning] = useState(false);
  const [vendRequest, setVendRequest] = useState<VendRequestEvent | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const nextId = useRef(0);

  const appendLog = useCallback((line: string) => {
    setLog(prev => {
      const rows = [{ id: nextId.current++, line }, ...prev];
      return rows.length > MAX_LOG_LINES ? rows.slice(0, MAX_LOG_LINES) : rows;
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const id = await Mdb.getSuggestedDeviceId();
      if (!mounted) return;
      setDeviceId(id);

      Mdb.initMqtt(TOPIC_PREFIX, id);
      Mdb.startMqtt();
      Mdb.initMdb();
      Mdb.startMdb();
      setRunning(true);
      appendLog(`-- started, device ID: ${id} --`);
    })();

    const subs = [
      // Engine log lines. showOnScreen=false marks per-poll noise - never render those
      // into a growing list (that is what froze the native app on real hardware).
      Mdb.onLog(({ line, showOnScreen }) => {
        if (showOnScreen) appendLog(line);
      }),

      // Instant on every state transition + 3s heartbeat.
      Mdb.onStatus(({ json }) => {
        try {
          setMdbState(JSON.parse(json).state);
        } catch {}
      }),

      // THE payment hook: show the approval sheet; a real app calls its gateway here.
      Mdb.onVendRequest(e => setVendRequest(e)),

      Mdb.onVendSuccess(({ itemNumber }) => {
        appendLog(`[app] dispensed item ${itemNumber} -> CAPTURE payment`);
      }),
      Mdb.onVendFailure(() => {
        appendLog('[app] vend FAILED -> REFUND payment');
      }),
      Mdb.onSessionEnded(() => {
        setVendRequest(null); // covers cancel/timeout paths where no decision was made
        appendLog('[app] session ended -> cleanup');
      }),
      Mdb.onRemoteCommand(({ command }) => {
        appendLog(`[app] custom remote command: ${command}`);
      }),
    ];

    return () => {
      mounted = false;
      subs.forEach(s => s.remove());
    };
  }, [appendLog]);

  const approve = async () => {
    setVendRequest(null);
    const ok = await Mdb.approveVend();
    appendLog(ok ? '[app] approved -> VEND APPROVED on next poll' : '[app] approve ignored (no request pending)');
  };

  const deny = async () => {
    setVendRequest(null);
    await Mdb.cancelVendWith('vendDenied');
    appendLog('[app] declined -> VEND DENIED on next poll');
  };

  const toggleRun = () => {
    if (running) {
      Mdb.stopMdb();
      appendLog('-- MDB stopped --');
    } else {
      Mdb.startMdb();
      appendLog('-- MDB started --');
    }
    setRunning(!running);
  };

  const stateColor =
    mdbState === 'VEND_STATE' ? '#35c7ff'
    : mdbState === 'ENABLED_STATE' ? '#6fe89a'
    : mdbState === 'DISABLED_STATE' ? '#e8c766'
    : '#8ea0b5';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0e12" />

      <View style={styles.header}>
        <Text style={styles.title}>MDB RN DEMO</Text>
        <View style={[styles.badge, { borderColor: stateColor }]}>
          <View style={[styles.dot, { backgroundColor: stateColor }]} />
          <Text style={[styles.badgeText, { color: stateColor }]}>{mdbState}</Text>
        </View>
        <Text style={styles.deviceId}>ID:{deviceId}</Text>
      </View>

      <View style={styles.buttons}>
        <Pressable style={styles.btn} onPress={toggleRun}>
          <Text style={styles.btnText}>{running ? 'Stop MDB' : 'Start MDB'}</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => Mdb.beginSession()}>
          <Text style={styles.btnText}>Begin Session</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => setLog([])}>
          <Text style={styles.btnText}>Clear</Text>
        </Pressable>
      </View>

      <FlatList
        style={styles.log}
        data={log}
        inverted
        keyExtractor={item => String(item.id)}
        renderItem={({ item }) => <Text style={styles.logLine}>{item.line}</Text>}
      />

      <Modal visible={vendRequest !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>VEND REQUEST</Text>
            <Text style={styles.modalAmount}>
              SAR {vendRequest ? vendRequest.amount.toFixed(2) : ''}
            </Text>
            <Text style={styles.modalSub}>
              item {vendRequest?.itemNumber} - {vendRequest?.minorUnits} halalas (exact)
            </Text>
            <View style={styles.modalButtons}>
              <Pressable style={[styles.btn, styles.btnApprove]} onPress={approve}>
                <Text style={styles.btnText}>Approve</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnDeny]} onPress={deny}>
                <Text style={styles.btnText}>Deny</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0e12' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#232a33',
  },
  title: { color: '#d7e0ea', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  deviceId: { color: '#8ea0b5', fontSize: 12, marginLeft: 'auto' },
  buttons: { flexDirection: 'row', gap: 8, padding: 12 },
  btn: {
    backgroundColor: '#171d25',
    borderWidth: 1,
    borderColor: '#232a33',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  btnText: { color: '#d7e0ea', fontSize: 13, fontWeight: '600' },
  btnApprove: { borderColor: '#6fe89a' },
  btnDeny: { borderColor: '#e86f6f' },
  log: { flex: 1, paddingHorizontal: 12 },
  logLine: { color: '#9fb3c8', fontSize: 11, fontFamily: 'monospace', paddingVertical: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#12161c',
    borderWidth: 1,
    borderColor: '#35c7ff',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    minWidth: 280,
  },
  modalTitle: { color: '#35c7ff', fontWeight: '700', fontSize: 13, letterSpacing: 1 },
  modalAmount: { color: '#d7e0ea', fontWeight: '700', fontSize: 32 },
  modalSub: { color: '#8ea0b5', fontSize: 12 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 12 },
});
