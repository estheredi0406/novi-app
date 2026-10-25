import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { BackHeader } from "../../components/BackHeader";
import { Chip } from "../../components/Chip";
import { PrimaryButton } from "../../components/PrimaryButton";
import { TextButton } from "../../components/TextButton";
import { Screen } from "../../components/Screen";
import { type BarcodeShape, describeBarcode } from "../../lib/idBarcode";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Every code type the camera can read: the screen says which one the card
// carries, in case it is not the PDF417 it looks like.
const ALL_TYPES = ["pdf417", "qr", "datamatrix", "aztec", "code128", "code39", "code93", "ean13", "itf14"] as const;

// Recent iPhones cannot focus closer than about 15 to 20 cm with the main
// camera, so the card is held farther away and the image zoomed instead.
const ZOOMS = [0, 0.1, 0.2, 0.3];

// Development only: finds out how a Togolese ID card's barcode is laid
// out, to design the scan at sign-up (D35). It shows the SHAPE of the data
// (length, separators, whether something looks like a date or an NIU), never
// the data itself. Nothing is stored, sent to the API or written to the log.
export default function IdScanTestScreen() {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [shape, setShape] = useState<(BarcodeShape & { type: string }) | null>(null);
  const [zoom, setZoom] = useState(0.1);
  const [torch, setTorch] = useState(false);

  // The card's data is described at once and then dropped: only the
  // description is kept in memory.
  function onScanned(result: BarcodeScanningResult) {
    if (shape) return;
    setShape({ ...describeBarcode(result.data ?? ""), type: result.type });
  }

  if (!__DEV__) return null;

  return (
    <Screen>
      <BackHeader listenText={t("idScan.title")} />
      <Text style={[type.title, styles.indigo]}>{t("idScan.title")}</Text>
      <Text style={[type.small, styles.muted]}>{t("idScan.privacy")}</Text>

      {!permission?.granted ? (
        <PrimaryButton label={t("idScan.allowCamera")} onPress={() => void requestPermission()} />
      ) : shape === null ? (
        <View style={styles.cameraBox}>
          <CameraView
            style={styles.camera}
            facing="back"
            zoom={zoom}
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: [...ALL_TYPES] }}
            onBarcodeScanned={onScanned}
          />
          <Text style={[type.small, styles.muted]}>{t("idScan.aim")}</Text>
          <View style={styles.chips}>
            {ZOOMS.map((level) => (
              <Chip key={level} label={`${t("idScan.zoom")} ${Math.round(level * 100)} %`} selected={zoom === level} onPress={() => setZoom(level)} />
            ))}
          </View>
          <TextButton label={torch ? t("idScan.torchOff") : t("idScan.torchOn")} onPress={() => setTorch(!torch)} />
        </View>
      ) : (
        <View style={styles.result}>
          <Row label={t("idScan.type")} value={shape.type} />
          <Row label={t("idScan.length")} value={String(shape.length)} />
          <Row label={t("idScan.readable")} value={`${shape.readableShare} %`} />
          <Row label={t("idScan.lines")} value={String(shape.lines)} />
          <Row
            label={t("idScan.separators")}
            value={
              shape.separators.length === 0
                ? t("idScan.none")
                : shape.separators.map((s) => `${s.symbol === "\t" ? "TAB" : s.symbol} × ${s.count}`).join("   ")
            }
          />
          <Row label={t("idScan.digitRun")} value={String(shape.longestDigitRun)} />
          <Row label={t("idScan.dates")} value={String(shape.dateLike)} />
          <Row label={t("idScan.capitalWords")} value={String(shape.capitalWords)} />
          {shape.hints.map((hint) => (
            <Text key={hint} style={[type.small, styles.ink]}>
              {t(hint)}
            </Text>
          ))}
          <PrimaryButton label={t("idScan.again")} onPress={() => setShape(null)} />
        </View>
      )}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[type.body, styles.ink]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  cameraBox: { gap: 10 },
  camera: { height: 320, borderRadius: 14, overflow: "hidden" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  result: { gap: 10, padding: 16, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.line },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted, flexShrink: 1 },
});
