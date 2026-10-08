import { useEffect, useRef } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

export default function BarcodeScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let stop = false;

    reader
      .decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current!, (result) => {
        if (result && !stop) {
          stop = true;
          onDetected(result.getText());
        }
      })
      .catch(() => {
        // Camera not available/denied — the manual search box remains usable.
      });

    return () => {
      videoRef.current?.srcObject && (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
      <video ref={videoRef} className="w-full max-w-md rounded-lg" muted playsInline />
      <button onClick={onClose} className="mt-6 rounded-md bg-white px-6 py-2 font-medium">إغلاق</button>
    </div>
  );
}
