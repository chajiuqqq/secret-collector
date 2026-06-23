import { Badge } from "@/components/ui/badge";

const labels: Record<string, { label: string; className: string }> = {
  x: { label: "X", className: "bg-neutral-800 text-white hover:bg-neutral-700" },
  xiaohongshu: {
    label: "小红书",
    className: "bg-red-500 text-white hover:bg-red-600",
  },
  tg: { label: "TG", className: "bg-blue-500 text-white hover:bg-blue-600" },
};

export default function PlatformBadge({ platform }: { platform: string }) {
  const p = labels[platform] ?? { label: platform, className: "" };
  return <Badge className={p.className}>{p.label}</Badge>;
}
