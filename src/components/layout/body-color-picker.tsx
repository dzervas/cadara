import { ActionIcon, Popover, TextInput, Tooltip } from "@mantine/core";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import {
  hexToHsv,
  hsvToHex,
  hsvToRgb,
  normalizeHexInput,
  type Hsv,
} from "@/lib/hsv-color";

const WHEEL_SIZE = 184;

interface BodyColorPickerProps {
  anchor: { x: number; y: number };
  label: string;
  /** The body's colour when the picker opened; the revert target. */
  originalHex: string;
  /** Live preview while picking; not persisted. */
  onPreview: (hex: string) => void;
  onCommit: (hex: string) => void;
  onCancel: () => void;
}

/**
 * Custom body colour popover: hue/saturation wheel, brightness strip,
 * previous/new swatch and hex field. Changes preview live; Escape cancels,
 * Enter, the close button or clicking outside commits.
 */
export function BodyColorPicker({
  anchor,
  label,
  originalHex,
  onPreview,
  onCommit,
  onCancel,
}: BodyColorPickerProps) {
  const [hsv, setHsv] = useState(() => hexToHsv(originalHex));
  const [hex, setHex] = useState(originalHex);
  const [draft, setDraft] = useState(originalHex.slice(1).toUpperCase());

  const apply = (nextHex: string, nextHsv = hexToHsv(nextHex)) => {
    setHsv(nextHsv);
    setHex(nextHex);
    setDraft(nextHex.slice(1).toUpperCase());
    onPreview(nextHex);
  };
  const applyHsv = (nextHsv: Hsv) => apply(hsvToHex(nextHsv), nextHsv);

  return (
    <Popover
      opened
      onDismiss={() => onCommit(hex)}
      closeOnEscape={false}
      position="bottom-start"
      floatingStrategy="fixed"
      transitionProps={{ duration: 0 }}
      width={232}
      trapFocus
      styles={{
        dropdown: {
          padding: 12,
          backgroundColor: "var(--workbench-glass-fill-strong)",
          backdropFilter: "var(--workbench-glass-blur-panel)",
          WebkitBackdropFilter: "var(--workbench-glass-blur-panel)",
          border: "1px solid var(--workbench-glass-border)",
          borderRadius: 12,
          boxShadow: "var(--workbench-panel-shadow)",
        },
      }}
    >
      <Popover.Target>
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            left: anchor.x,
            top: anchor.y,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
      </Popover.Target>
      <Popover.Dropdown
        aria-label={`${label} custom color`}
        data-testid="body-color-picker"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter") {
            onCommit(normalizeHexInput(draft) ?? hex);
          }
        }}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span
              className="truncate text-[12.5px] font-semibold"
              style={{ color: "var(--workbench-shell-text)" }}
            >
              {label}
            </span>
            <ActionIcon
              variant="subtle"
              color="gray"
              size={22}
              aria-label="Close"
              onClick={() => onCommit(hex)}
            >
              <WorkbenchIcon name="close" className="h-3 w-3" />
            </ActionIcon>
          </div>
          <ColorWheel hsv={hsv} onChange={applyHsv} />
          <BrightnessStrip hsv={hsv} onChange={applyHsv} />
          <div className="flex items-center gap-2">
            <Tooltip label="Previous color · click to revert" openDelay={300}>
              <button
                type="button"
                aria-label="Revert to previous color"
                onClick={() => apply(originalHex)}
                className="flex h-[30px] w-[44px] shrink-0 cursor-pointer overflow-hidden rounded-md p-0"
                style={{ border: "1px solid var(--workbench-shell-border)" }}
              >
                <span className="h-full flex-1" style={{ background: originalHex }} />
                <span className="h-full flex-1" style={{ background: hex }} />
              </button>
            </Tooltip>
            <TextInput
              aria-label="Hex color"
              size="xs"
              className="flex-1"
              leftSection={<span className="font-mono text-[12px]">#</span>}
              leftSectionWidth={22}
              maxLength={7}
              spellCheck={false}
              value={draft}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const next = event.currentTarget.value
                  .replace(/^#/, "")
                  .toUpperCase();
                setDraft(next);
                const nextHex = next.length === 6 ? normalizeHexInput(next) : null;
                if (nextHex) apply(nextHex);
              }}
              onBlur={() => {
                const nextHex = normalizeHexInput(draft);
                if (nextHex) apply(nextHex);
                else setDraft(hex.slice(1).toUpperCase());
              }}
              styles={{
                input: {
                  fontFamily: "var(--mantine-font-family-monospace)",
                  fontSize: 12,
                  height: 30,
                  minHeight: 30,
                },
              }}
            />
          </div>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

function usePointerDrag(onPoint: (event: ReactPointerEvent<HTMLDivElement>) => void) {
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      onPoint(event);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        onPoint(event);
      }
    },
  };
}

function ColorWheel({ hsv, onChange }: { hsv: Hsv; onChange: (hsv: Hsv) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const size = Math.round(WHEEL_SIZE * window.devicePixelRatio);
    canvas.width = size;
    canvas.height = size;
    const image = context.createImageData(size, size);
    const radius = size / 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - radius + 0.5;
        const dy = y - radius + 0.5;
        const distance = Math.hypot(dx, dy);
        if (distance > radius) continue;
        const [r, g, b] = hsvToRgb({
          h: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360,
          s: distance / radius,
          v: 1,
        });
        const offset = (y * size + x) * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        // One anti-aliased pixel at the rim.
        image.data[offset + 3] = Math.round(255 * Math.min(1, radius - distance));
      }
    }
    context.putImageData(image, 0, 0);
  }, []);

  const drag = usePointerDrag((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    onChange({
      h: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360,
      s: Math.min(1, Math.hypot(dx, dy) / (rect.width / 2)),
      // Picking a hue on a black colour would otherwise stay black.
      v: hsv.v === 0 ? 1 : hsv.v,
    });
  });
  const angle = (hsv.h * Math.PI) / 180;
  const radius = WHEEL_SIZE / 2;

  return (
    <div
      role="slider"
      aria-label="Hue and saturation"
      aria-valuetext={`Hue ${Math.round(hsv.h)}°, saturation ${Math.round(hsv.s * 100)}%`}
      className="relative self-center touch-none"
      style={{ width: WHEEL_SIZE, height: WHEEL_SIZE, cursor: "crosshair" }}
      {...drag}
    >
      <canvas
        ref={canvasRef}
        style={{ width: WHEEL_SIZE, height: WHEEL_SIZE, display: "block" }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{
          background: "var(--workbench-color-picker-shade)",
          opacity: 1 - hsv.v,
          boxShadow: "var(--workbench-color-picker-inset)",
        }}
      />
      <Handle
        x={radius + Math.cos(angle) * hsv.s * radius}
        y={radius + Math.sin(angle) * hsv.s * radius}
        color={hsvToHex(hsv)}
      />
    </div>
  );
}

function BrightnessStrip({
  hsv,
  onChange,
}: {
  hsv: Hsv;
  onChange: (hsv: Hsv) => void;
}) {
  const drag = usePointerDrag((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange({
      ...hsv,
      v: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    });
  });

  return (
    <div
      role="slider"
      aria-label="Brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsv.v * 100)}
      tabIndex={0}
      className="relative h-3 cursor-pointer touch-none rounded-full"
      style={{
        background: `linear-gradient(to right, var(--workbench-color-picker-shade), ${hsvToHex({ ...hsv, v: 1 })})`,
        boxShadow: "var(--workbench-color-picker-inset)",
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.01;
        if (event.key === "ArrowLeft") {
          onChange({ ...hsv, v: Math.max(0, hsv.v - step) });
        } else if (event.key === "ArrowRight") {
          onChange({ ...hsv, v: Math.min(1, hsv.v + step) });
        }
      }}
      {...drag}
    >
      <Handle x={`${hsv.v * 100}%`} y={6} color={hsvToHex(hsv)} />
    </div>
  );
}

function Handle({ x, y, color }: { x: number | string; y: number; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute rounded-full"
      style={{
        left: x,
        top: y,
        width: 14,
        height: 14,
        transform: "translate(-50%, -50%)",
        background: color,
        border: "2px solid var(--workbench-shell-text)",
        boxShadow: "var(--workbench-color-picker-handle-shadow)",
      }}
    />
  );
}
