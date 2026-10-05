import { Volume2, VolumeX } from "lucide-react";
export default function SoundToggle({
  enabled,
  remembered,
  onToggle,
}: {
  enabled: boolean;
  remembered: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="sound-toggle"
      aria-label={enabled ? "إيقاف الصوت" : "تشغيل الصوت"}
      title={
        !enabled && remembered ? "تفضيل الصوت محفوظ — اضغط لتفعيله" : undefined
      }
      aria-pressed={enabled}
      onClick={onToggle}
    >
      {enabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
    </button>
  );
}
