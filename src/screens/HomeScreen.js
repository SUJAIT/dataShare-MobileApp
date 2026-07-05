import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  Modal,
  Switch,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Network from 'expo-network';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { DataShareServer, RECEIVED_DIR } from '../server/httpServer';

const PORT = 3000;

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export default function HomeScreen() {
  const [ip, setIp] = useState(null);
  const [serverReady, setServerReady] = useState(false);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [hotspotMode, setHotspotMode] = useState(false);

  // Confirmation modal state - shared for both "delete one" and "delete all"
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null); // null = delete all, otherwise a file object

  const loadFilesFromDisk = useCallback(async () => {
    const dirInfo = await FileSystem.getInfoAsync(RECEIVED_DIR);
    if (!dirInfo.exists) return;
    const names = await FileSystem.readDirectory(RECEIVED_DIR);
    const files = await Promise.all(
      names.map(async (name) => {
        const path = RECEIVED_DIR + name;
        const info = await FileSystem.getInfoAsync(path);
        // stored filenames are "<timestamp>-<originalname>"
        const originalName = name.split('-').slice(1).join('-') || name;
        return {
          name: originalName,
          path,
          size: info.size || 0,
          receivedAt: info.modificationTime ? info.modificationTime * 1000 : Date.now(),
        };
      })
    );
    files.sort((a, b) => b.receivedAt - a.receivedAt);
    setReceivedFiles(files);
  }, []);

  const onFileReceived = useCallback(() => {
    // Simplest reliable approach: re-read the folder whenever a new file
    // arrives, so names/sizes are always accurate and the list survives
    // app restarts too.
    loadFilesFromDisk();
  }, [loadFilesFromDisk]);

  useEffect(() => {
    let server;
    (async () => {
      const ipAddress = await Network.getIpAddressAsync();
      setIp(ipAddress);
      await loadFilesFromDisk();

      server = new DataShareServer({ port: PORT, onFileReceived });
      await server.start();
      setServerReady(true);
    })();

    return () => {
      if (server) server.stop();
    };
  }, [onFileReceived, loadFilesFromDisk]);

  function askDeleteOne(file) {
    setConfirmTarget(file);
    setConfirmVisible(true);
  }

  function askDeleteAll() {
    setConfirmTarget(null);
    setConfirmVisible(true);
  }

  async function confirmDelete() {
    if (confirmTarget) {
      // Delete a single file
      await FileSystem.deleteAsync(confirmTarget.path, { idempotent: true });
    } else {
      // Delete everything
      for (const file of receivedFiles) {
        await FileSystem.deleteAsync(file.path, { idempotent: true });
      }
    }
    setConfirmVisible(false);
    setConfirmTarget(null);
    await loadFilesFromDisk();
  }

  async function openFile(file) {
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(file.path);
    }
  }

  if (!serverReady || !ip) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Starting DataShare...</Text>
      </View>
    );
  }

  const shareUrl = `http://${ip}:${PORT}`;
  const totalSize = receivedFiles.reduce((sum, f) => sum + (f.size || 0), 0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Scan to send</Text>
      <View style={styles.qrBox}>
        <QRCode value={shareUrl} size={200} />
      </View>
      <Text style={styles.urlText}>{shareUrl}</Text>

      <View style={styles.hotspotRow}>
        <Text style={styles.hotspotLabel}>Using this phone's Hotspot</Text>
        <Switch value={hotspotMode} onValueChange={setHotspotMode} />
      </View>
      <Text style={styles.hint}>
        {hotspotMode
          ? 'Turn on Mobile Hotspot in your phone\'s Settings first, then have the sending device connect to it like a WiFi network before scanning.'
          : 'Make sure the sending device is on the same WiFi network, then scan this code with its camera.'}
      </Text>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>
          Received files ({receivedFiles.length})
        </Text>
        {receivedFiles.length > 0 && (
          <TouchableOpacity onPress={askDeleteAll}>
            <Text style={styles.deleteAllText}>Delete all</Text>
          </TouchableOpacity>
        )}
      </View>
      {receivedFiles.length > 0 && (
        <Text style={styles.storageText}>{formatBytes(totalSize)} used</Text>
      )}

      {receivedFiles.length === 0 ? (
        <Text style={styles.emptyText}>No files received yet.</Text>
      ) : (
        <FlatList
          data={receivedFiles}
          keyExtractor={(item) => item.path}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.fileRow} onPress={() => openFile(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.fileMeta}>{formatBytes(item.size)}</Text>
              </View>
              <TouchableOpacity onPress={() => askDeleteOne(item)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={confirmVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>
              {confirmTarget ? 'Delete this file?' : 'Delete all files?'}
            </Text>
            <Text style={styles.modalMessage}>
              {confirmTarget
                ? `"${confirmTarget.name}" will be permanently removed from this phone.`
                : `All ${receivedFiles.length} received files will be permanently removed from this phone.`}
            </Text>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancel]}
                onPress={() => setConfirmVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalConfirm]}
                onPress={confirmDelete}
              >
                <Text style={styles.modalConfirmText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 50 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: '#666' },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  qrBox: { alignSelf: 'center', padding: 14, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#eee' },
  urlText: { textAlign: 'center', color: '#2563eb', marginTop: 10, fontSize: 13 },
  hotspotRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingHorizontal: 4 },
  hotspotLabel: { fontSize: 14, color: '#333', fontWeight: '600' },
  hint: { textAlign: 'center', color: '#888', fontSize: 12, marginTop: 6, paddingHorizontal: 8 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  deleteAllText: { color: '#dc2626', fontWeight: '600', fontSize: 13 },
  storageText: { color: '#999', fontSize: 12, marginTop: 2, marginBottom: 8 },
  emptyText: { color: '#999', textAlign: 'center', marginTop: 20 },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f5f5f7',
    borderRadius: 8,
    marginBottom: 8,
  },
  fileName: { fontSize: 14, color: '#333', fontWeight: '500' },
  fileMeta: { fontSize: 11, color: '#999', marginTop: 2 },
  deleteBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  deleteBtnText: { color: '#dc2626', fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { width: '82%', backgroundColor: '#fff', borderRadius: 14, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  modalMessage: { fontSize: 14, color: '#555', marginBottom: 20 },
  modalButtonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  modalButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  modalCancel: { backgroundColor: '#f0f0f0' },
  modalCancelText: { color: '#333', fontWeight: '600' },
  modalConfirm: { backgroundColor: '#dc2626' },
  modalConfirmText: { color: '#fff', fontWeight: '600' },
});

